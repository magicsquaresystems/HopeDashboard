/**
 * Platform hand-off: how a facilitator arrives already identified.
 *
 * Facilitators do not sign in here. They click through from the main
 * Hope Move dashboard, which already knows who they are, and that
 * identity travels with them in a short-lived signed token rather than
 * being re-entered. A second password prompt in the middle of an
 * existing session is friction with no security benefit — and an
 * unsigned `?email=` would let anyone claim to be anyone.
 *
 * Token format (deliberately dependency-free, so the platform can mint
 * one in any language):
 *
 *     token = base64url(JSON payload) + "." + base64url(HMAC-SHA256(secret, payload))
 *
 *     payload = {
 *       "email":   "facilitator@hopemove.org",   // required
 *       "name":    "Facilitator name",           // optional, for the topbar
 *       "cohorts": [1680],                       // optional, overrides assignments
 *       "exp":     1786048951                    // required, unix SECONDS
 *     }
 *
 * The secret is `HOPE_HANDOFF_SECRET`, shared with the platform.
 *
 * Two rules make replay uninteresting: `exp` must be in the future, and
 * it must be within `MAX_TOKEN_LIFETIME_S` of now — so a token minted
 * with a ten-year expiry is rejected rather than becoming a permanent
 * bearer credential if it leaks into a log or a referrer header.
 *
 * Web Crypto (not node:crypto) so this works unchanged if the gate ever
 * moves to the Edge runtime.
 */

/** Longest window we honour, regardless of what `exp` claims. */
export const MAX_TOKEN_LIFETIME_S = 5 * 60;

export type HandoffClaims = {
    email: string;
    name?: string;
    cohorts?: number[];
    exp: number;
};

export function handoffSecret(): string | null {
    const raw =
        process.env.HOPE_HANDOFF_SECRET?.trim() ||
        process.env.AUTH_SECRET?.trim();
    return raw ? raw : null;
}

function b64urlToBytes(s: string): Uint8Array {
    const pad = s.length % 4 === 0 ? "" : "=".repeat(4 - (s.length % 4));
    const b64 = s.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
}

function bytesToB64url(bytes: Uint8Array): string {
    let bin = "";
    for (const b of bytes) bin += String.fromCharCode(b);
    return btoa(bin).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function hmac(secret: string, message: string): Promise<Uint8Array> {
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey(
        "raw",
        enc.encode(secret),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"],
    );
    const sig = await crypto.subtle.sign("HMAC", key, enc.encode(message));
    return new Uint8Array(sig);
}

/** Constant-time compare — a fast-exit compare leaks the signature. */
function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
    return diff === 0;
}

/** Mints a token. Used by tests and the local dev helper script; the
 *  platform mints its own in whatever language it runs. */
export async function signHandoffToken(
    claims: Omit<HandoffClaims, "exp"> & { exp?: number },
    secret: string,
    nowMs: number = Date.now(),
): Promise<string> {
    const payload: HandoffClaims = {
        ...claims,
        exp: claims.exp ?? Math.floor(nowMs / 1000) + 120,
    };
    const encoded = bytesToB64url(
        new TextEncoder().encode(JSON.stringify(payload)),
    );
    const sig = await hmac(secret, encoded);
    return `${encoded}.${bytesToB64url(sig)}`;
}

export type HandoffResult =
    | { ok: true; claims: HandoffClaims }
    | { ok: false; reason: string };

export async function verifyHandoffToken(
    token: string,
    secret: string,
    nowMs: number = Date.now(),
): Promise<HandoffResult> {
    const parts = token.split(".");
    if (parts.length !== 2) return { ok: false, reason: "malformed token" };
    const [encoded, providedSig] = parts;

    let expected: Uint8Array;
    try {
        expected = await hmac(secret, encoded);
    } catch {
        return { ok: false, reason: "signature check failed" };
    }
    let provided: Uint8Array;
    try {
        provided = b64urlToBytes(providedSig);
    } catch {
        return { ok: false, reason: "malformed signature" };
    }
    if (!timingSafeEqual(expected, provided)) {
        return { ok: false, reason: "bad signature" };
    }

    let claims: HandoffClaims;
    try {
        claims = JSON.parse(new TextDecoder().decode(b64urlToBytes(encoded)));
    } catch {
        return { ok: false, reason: "malformed payload" };
    }

    const email = String(claims?.email ?? "").trim().toLowerCase();
    if (!email || !email.includes("@")) {
        return { ok: false, reason: "missing email" };
    }
    if (typeof claims.exp !== "number" || !Number.isFinite(claims.exp)) {
        return { ok: false, reason: "missing exp" };
    }
    const nowS = Math.floor(nowMs / 1000);
    if (claims.exp <= nowS) return { ok: false, reason: "token expired" };
    if (claims.exp - nowS > MAX_TOKEN_LIFETIME_S) {
        // A long-lived token is a password in a URL. Refuse it even
        // though the signature is valid.
        return { ok: false, reason: "exp too far in the future" };
    }

    const cohorts = Array.isArray(claims.cohorts)
        ? claims.cohorts.map(Number).filter(Number.isFinite)
        : undefined;

    return {
        ok: true,
        claims: {
            email,
            name: typeof claims.name === "string" ? claims.name : undefined,
            cohorts,
            exp: claims.exp,
        },
    };
}
