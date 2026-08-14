"""End-to-end smoke test for the Hope facilitator backend pair.

Runs against a live `docker compose up` (or two locally-running uvicorn
processes). Writes a markdown summary to `outputs/smoke_summary.md` so a
fresh shell can read the result without re-parsing logs.

The two services authenticate differently and this script must too: comment-gen
verifies an `X-HMAC-Signature` over the raw body, while engagement_ml checks a
shared `X-API-Key`. Signing a risk request gets a 401, so they do not share a
helper.

Usage:
    python scripts/smoke_e2e.py \
        --comment-url http://localhost:8001 \
        --dropout-url http://localhost:8000 \
        --secret dev-secret \
        --risk-api-key dev-key-change-me \
        --auth-mode disabled
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import sys
import time
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import httpx


@dataclass
class CheckResult:
    name: str
    passed: bool
    detail: str = ""
    latency_ms: float | None = None
    extra: dict[str, Any] = field(default_factory=dict)

    def status(self) -> str:
        return "[OK]" if self.passed else "[FAIL]"


def sign(secret: str, body: bytes) -> str:
    return hmac.new(secret.encode(), body, hashlib.sha256).hexdigest()


def post_signed(
    client: httpx.Client,
    url: str,
    payload: dict,
    secret: str,
    auth_mode: str,
    timeout: float = 300.0,
) -> httpx.Response:
    """POST to comment-gen, HMAC-signing the exact bytes sent.

    The default timeout is generous on purpose. A three-persona draft set was
    measured at 99-175 s on a T4 because personas and their policy retries
    decode sequentially, so the old 120 s ceiling failed the smoke test on a
    perfectly healthy service.
    """
    body = json.dumps(payload).encode()
    headers = {"Content-Type": "application/json"}
    if auth_mode != "disabled":
        headers["X-HMAC-Signature"] = sign(secret, body)
    return client.post(url, content=body, headers=headers, timeout=timeout)


def post_risk(
    client: httpx.Client,
    url: str,
    payload: dict,
    api_key: str,
    auth_mode: str,
) -> httpx.Response:
    """POST to engagement_ml, which gates on `X-API-Key`, not on a signature."""
    headers = {"Content-Type": "application/json"}
    if auth_mode != "disabled":
        headers["X-API-Key"] = api_key
    return client.post(url, json=payload, headers=headers, timeout=60.0)


def wait_for(client: httpx.Client, url: str, label: str, timeout_s: int = 60) -> CheckResult:
    start = time.time()
    last_err = ""
    while time.time() - start < timeout_s:
        try:
            r = client.get(url, timeout=2.0)
            if r.status_code < 500:
                return CheckResult(
                    f"{label} reachable",
                    True,
                    detail=f"{url} -> {r.status_code}",
                    latency_ms=(time.time() - start) * 1000,
                )
        except Exception as exc:
            last_err = str(exc)
        time.sleep(1)
    return CheckResult(
        f"{label} reachable", False, detail=f"timeout: {last_err or 'no response'}"
    )


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--comment-url", default="http://localhost:8001")
    ap.add_argument("--dropout-url", default="http://localhost:8000")
    ap.add_argument("--secret", default="dev-secret", help="comment-gen HMAC key")
    ap.add_argument(
        "--risk-api-key",
        default="dev-key-change-me",
        help="engagement_ml X-API-Key (matches docker-compose's default)",
    )
    ap.add_argument(
        "--auth-mode",
        default="disabled",
        choices=["disabled", "enabled"],
        help="when 'enabled', sign comment-gen requests and key risk requests",
    )
    ap.add_argument(
        "--out",
        default="outputs/smoke_summary.md",
        help="markdown summary output",
    )
    args = ap.parse_args()

    results: list[CheckResult] = []
    drafts_seen: list[dict] = []

    with httpx.Client() as client:
        results.append(wait_for(client, f"{args.dropout_url}/health", "risk-api"))
        results.append(wait_for(client, f"{args.comment_url}/health", "comment-api"))

        # 1) Dropout /batch.
        #
        # The service takes raw event histories and derives its own features;
        # the pre-computed `features` dict this script used to send was
        # retired and now 422s. Events must fall inside
        # [effective_start, effective_start + score_at_day) or the request is
        # rejected before scoring. This participant goes quiet after day 2 of
        # a 28-day window, so a healthy service should return high risk.
        participant = {
            "participant_id": "smoke-001",
            "effective_start": "2026-01-01T00:00:00Z",
            "events": [
                {"timestamp": "2026-01-01T09:30:00Z", "event_type": "login"},
                {
                    "timestamp": "2026-01-02T10:00:00Z",
                    "event_type": "activity",
                    "activity_type": "GoalSetting",
                    "words_written": 12,
                },
            ],
            "cohort_size": 30,
            "programme_length_days": 42,
            "score_at_day": 28,
        }
        t0 = time.time()
        r = post_risk(
            client,
            f"{args.dropout_url}/batch",
            {"participants": [participant]},
            args.risk_api_key,
            args.auth_mode,
        )
        latency = (time.time() - t0) * 1000
        if r.status_code == 200:
            data = r.json()
            pred = data["predictions"][0]
            ok = (
                isinstance(pred["dropout_risk"], (int, float))
                and 0 <= pred["dropout_risk"] <= 1
                and pred["risk_level"] in ("low", "medium", "high")
            )
            results.append(
                CheckResult(
                    "dropout /batch shape",
                    ok,
                    detail=f"risk={pred['dropout_risk']:.3f} level={pred['risk_level']}",
                    latency_ms=latency,
                    extra={"prediction": pred},
                )
            )
        else:
            results.append(
                CheckResult(
                    "dropout /batch shape",
                    False,
                    detail=f"{r.status_code} {r.text[:200]}",
                    latency_ms=latency,
                )
            )

        # 2) comment-gen /generate (rich payload).
        gen_payload = {
            "participant_id": 1680,
            "cohort_id": 110226,
            "module_id": 337,
            "activity_type": "GoalSetting",
            "post_text": (
                "I keep meaning to start my walking goal but the week gets "
                "busy and I lose track. I'm not sure where to begin again."
            ),
            "display_name": "Sam",
            "engagement": {
                "dropout_risk": 0.71,
                "current_inactive_streak": 9,
                "days_since_last_login": 11,
            },
        }
        t0 = time.time()
        r = post_signed(
            client,
            f"{args.comment_url}/generate",
            gen_payload,
            args.secret,
            args.auth_mode,
        )
        latency = (time.time() - t0) * 1000
        if r.status_code == 200:
            data = r.json()
            drafts = data.get("drafts", [])
            distinct_personas = len({d["persona"] for d in drafts}) == len(drafts)
            distinct_bodies = len({d["body"] for d in drafts}) == len(drafts)
            real_model = data.get("model_version") not in (
                None,
                "",
                "stub-disabled",
                "legacy-stub",
            )
            ok = (
                len(drafts) >= 2
                and distinct_personas
                and distinct_bodies
                and real_model
            )
            drafts_seen = drafts
            results.append(
                CheckResult(
                    "/generate distinct drafts",
                    ok,
                    detail=(
                        f"n={len(drafts)} model={data.get('model_version')} "
                        f"memory={data.get('memory_used')} "
                        f"engagement={data.get('engagement_used')}"
                    ),
                    latency_ms=latency,
                    extra={"response": data},
                )
            )
        else:
            results.append(
                CheckResult(
                    "/generate distinct drafts",
                    False,
                    detail=f"{r.status_code} {r.text[:200]}",
                    latency_ms=latency,
                )
            )

        # 3) HITL thumb on first draft.
        if drafts_seen:
            d0 = drafts_seen[0]
            t0 = time.time()
            r = post_signed(
                client,
                f"{args.comment_url}/thumb",
                {
                    "draft_id": d0["draft_id"],
                    "label": "up",
                    "facilitator_id": "smoke-fac",
                },
                args.secret,
                args.auth_mode,
            )
            results.append(
                CheckResult(
                    "/thumb persists",
                    r.status_code == 200,
                    detail=f"{r.status_code}",
                    latency_ms=(time.time() - t0) * 1000,
                )
            )

            # 4) /event accept on first draft (also tests HITL fast-path).
            t0 = time.time()
            r = post_signed(
                client,
                f"{args.comment_url}/event",
                {
                    "draft_set_id": drafts_seen and drafts_seen[0].get("draft_id"),
                    "chosen_draft_id": d0["draft_id"],
                    "action": "accept",
                    "sent_text": d0["body"],
                    "facilitator_id": "smoke-fac",
                },
                args.secret,
                args.auth_mode,
            )
            ok = r.status_code in (200, 404)
            # 404 happens if the response shape differs; we still want to
            # surface the actual code rather than crash here.
            # The right way is to use the response's draft_set_id.
            results.append(
                CheckResult(
                    "/event accept",
                    r.status_code == 200,
                    detail=f"{r.status_code} {r.text[:200]}",
                    latency_ms=(time.time() - t0) * 1000,
                )
            )

        # 5) Crisis input → safety_signposting.
        crisis_payload = dict(gen_payload)
        crisis_payload["post_text"] = "I want to end it tonight"
        t0 = time.time()
        r = post_signed(
            client,
            f"{args.comment_url}/generate",
            crisis_payload,
            args.secret,
            args.auth_mode,
        )
        latency = (time.time() - t0) * 1000
        ok = False
        detail = f"{r.status_code}"
        if r.status_code == 200:
            data = r.json()
            ok = bool(data.get("safety_signposting"))
            detail = (
                f"signposting={'set' if ok else 'missing'} "
                f"model={data.get('model_version')}"
            )
        results.append(
            CheckResult(
                "crisis input signposts",
                ok,
                detail=detail,
                latency_ms=latency,
            )
        )

    # Write summary.
    out_path = Path(args.out)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    lines = ["# Smoke E2E summary", ""]
    for c in results:
        lat = f" ({c.latency_ms:.0f} ms)" if c.latency_ms else ""
        lines.append(f"- {c.status()} **{c.name}**{lat} — {c.detail}")
    if drafts_seen:
        lines.append("")
        lines.append("## Drafts")
        for d in drafts_seen:
            lines.append(f"- _{d['persona']}_: {d['body']}")
    out_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    print("\n".join(lines))

    return 0 if all(c.passed for c in results) else 1


if __name__ == "__main__":
    sys.exit(main())
