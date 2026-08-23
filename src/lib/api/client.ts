import type { components } from "./types";

export type Schemas = components["schemas"];

export type ApiClientOptions = {
    baseUrl: string;
    /**
     * Hex-encoded HMAC-SHA256 signature provider. Returns the signature for
     * a given raw body. Server-side only; never invoke from a browser
     * environment. Used by the comment-gen backend, which enforces HMAC
     * via `HOPE_API_SECRET`.
     */
    sign?: (body: string) => Promise<string>;
    /**
     * Shared API key sent as `X-API-Key`. Server-side only. Used by the
     * engagement_ml risk-prediction backend, which enforces a single
     * shared bearer token rather than HMAC.
     */
    apiKey?: string;
    /**
     * Hugging Face token sent as `Authorization: Bearer <token>` on every
     * request. Required for invoking *private* HF Spaces; the HF gateway
     * rejects unauthenticated requests at the network edge before they
     * reach the application. Server-side only.
     */
    authToken?: string;
    /**
     * Forwarded session cookie when calling read endpoints from the
     * Next.js Route Handler proxy.
     */
    cookie?: string;
    /**
     * Extra headers attached to every request from this client. Used by
     * the Hope platform client, whose backend cannot survive Node
     * fetch's default `Accept-Language: *` — see `createHopeClient`.
     */
    headers?: Record<string, string>;
    fetchImpl?: typeof fetch;
};

export class ApiError extends Error {
    constructor(
        readonly status: number,
        readonly detail: string,
        readonly code?: string,
    ) {
        super(`${status} ${detail}`);
        this.name = "ApiError";
    }
}

/**
 * Turn a non-2xx upstream response into an `ApiError` without losing
 * the reason.
 *
 * This used to read only our own services' shape, `{ detail, code }`,
 * and fall back to `statusText` for anything else. The Hope platform is
 * not one of our services: its `ApiError(...)` helper and ASP.NET's own
 * `HttpError` both use different field names, so a platform 400 arrived
 * in the dashboard as the two words "Bad Request" and nothing else — the
 * sentence that said what was wrong had been thrown away one hop from
 * the screen. A send that fails with no reason cannot be fixed by the
 * person looking at it, or by anyone they ask.
 *
 * Keys are matched case-insensitively because the same C# property
 * reaches the wire as `Message` or `message` depending on the
 * serializer's naming policy, which this codebase has already been
 * bitten by once (see `hope.ts`). Shapes recognised:
 *
 *   - ours:              { detail, code }
 *   - Hope `ApiError`:   { code | errorCode, message, data }
 *   - ASP.NET HttpError: { Message, MessageDetail, ExceptionMessage }
 *   - RFC 7807:          { title, detail, errors }
 *   - anything else:     the raw body, truncated
 *
 * Exported for its tests; nothing else should need it.
 */
export async function upstreamError(res: Response): Promise<ApiError> {
    const raw = await res.text().catch(() => "");
    let detail = raw.trim() || res.statusText || `HTTP ${res.status}`;
    let code: string | undefined;

    if (raw.trim()) {
        let parsed: unknown;
        try {
            parsed = JSON.parse(raw);
        } catch {
            parsed = undefined;
        }
        if (parsed && typeof parsed === "object") {
            const fields = new Map<string, unknown>();
            for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
                fields.set(k.toLowerCase(), v);
            }
            const text = (...keys: string[]): string | undefined => {
                for (const k of keys) {
                    const v = fields.get(k);
                    if (typeof v === "string" && v.trim()) return v.trim();
                }
                return undefined;
            };
            const message = text(
                "detail",
                "message",
                "messagedetail",
                "exceptionmessage",
                "title",
                "error",
            );
            const extra = text("messagedetail");
            detail =
                message && extra && extra !== message
                    ? `${message} ${extra}`
                    : (message ?? detail);
            code = text("code", "errorcode");
        }
    }

    // A gateway's HTML page, or a stack trace: keep enough to recognise
    // it, not enough to flood a log line or a disclosure.
    if (detail.length > 400) detail = `${detail.slice(0, 400)}…`;
    return new ApiError(res.status, detail, code);
}

type RequestOptions = {
    method?: "GET" | "POST" | "DELETE";
    path: string;
    query?: Record<string, string | number | undefined>;
    body?: unknown;
    /**
     * Auth requirement for this request. `"hmac"` triggers `X-HMAC-Signature`
     * (comment-gen contract); `"apiKey"` triggers `X-API-Key`
     * (engagement_ml risk-prediction contract); `false`/omitted means the
     * endpoint is public (e.g. `/health`). The HF gateway `Authorization`
     * header is attached automatically whenever the client was built with
     * `authToken`.
     */
    auth?: "hmac" | "apiKey" | false;
    /** Back-compat alias for `auth: "hmac"`. */
    signed?: boolean;
};

export function createClient(opts: ApiClientOptions) {
    const fetchImpl = opts.fetchImpl ?? fetch;

    async function request<T>({
        method = "GET",
        path,
        query,
        body,
        signed,
        auth,
    }: RequestOptions): Promise<T> {
        const url = new URL(path, opts.baseUrl);
        if (query) {
            for (const [k, v] of Object.entries(query)) {
                if (v !== undefined) url.searchParams.set(k, String(v));
            }
        }

        const headers: Record<string, string> = { ...opts.headers };
        let rawBody: string | undefined;
        if (body !== undefined) {
            rawBody = JSON.stringify(body);
            headers["Content-Type"] = "application/json";
        }
        const effectiveAuth = auth ?? (signed ? "hmac" : false);
        // A missing credential is a deployment that was never configured,
        // not a backend that broke. Thrown as `ApiError(503)` so the proxy
        // layer reports it as exactly that: a bare `Error` there falls into
        // the "upstream unreachable" branch, which returns 502 and puts this
        // sentence in front of a facilitator, who then waits for a service
        // that was never going to answer. The env var is named because the
        // only person who can act on this is reading a log or a status page,
        // and no secret is disclosed by saying which one is absent.
        if (effectiveAuth === "hmac") {
            if (!opts.sign) {
                throw new ApiError(
                    503,
                    "This deployment is missing HOPE_API_SECRET, so the " +
                        "comment service cannot be called.",
                    "backend_not_configured",
                );
            }
            headers["X-HMAC-Signature"] = await opts.sign(rawBody ?? "");
        } else if (effectiveAuth === "apiKey") {
            if (!opts.apiKey) {
                throw new ApiError(
                    503,
                    "This deployment is missing HOPE_RISK_API_KEY, so the " +
                        "risk service cannot be called.",
                    "backend_not_configured",
                );
            }
            headers["X-API-Key"] = opts.apiKey;
        }
        if (opts.authToken) {
            // HF private-Space gateway gate. Attached on every request,
            // including unauthenticated /health, because HF rejects at the
            // edge before the application sees the request.
            headers["Authorization"] = `Bearer ${opts.authToken}`;
        }
        if (opts.cookie) {
            headers["Cookie"] = opts.cookie;
        }

        const res = await fetchImpl(url.toString(), {
            method,
            headers,
            body: rawBody,
        });

        if (!res.ok) {
            throw await upstreamError(res);
        }

        if (res.status === 204) return undefined as T;
        const ct = res.headers.get("content-type") ?? "";
        return (ct.includes("application/json") ? await res.json() : (await res.text())) as T;
    }

    return { request };
}
