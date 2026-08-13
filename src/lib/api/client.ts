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

        const headers: Record<string, string> = {};
        let rawBody: string | undefined;
        if (body !== undefined) {
            rawBody = JSON.stringify(body);
            headers["Content-Type"] = "application/json";
        }
        const effectiveAuth = auth ?? (signed ? "hmac" : false);
        if (effectiveAuth === "hmac") {
            if (!opts.sign) {
                throw new Error("HMAC request requires `sign` option");
            }
            headers["X-HMAC-Signature"] = await opts.sign(rawBody ?? "");
        } else if (effectiveAuth === "apiKey") {
            if (!opts.apiKey) {
                throw new Error("API-key request requires `apiKey` option");
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
            let detail = res.statusText;
            let code: string | undefined;
            try {
                const err = (await res.json()) as Schemas["ErrorResponse"];
                detail = err.detail ?? detail;
                code = err.code ?? undefined;
            } catch {
                /* response had no JSON body */
            }
            throw new ApiError(res.status, detail, code);
        }

        if (res.status === 204) return undefined as T;
        const ct = res.headers.get("content-type") ?? "";
        return (ct.includes("application/json") ? await res.json() : (await res.text())) as T;
    }

    return { request };
}
