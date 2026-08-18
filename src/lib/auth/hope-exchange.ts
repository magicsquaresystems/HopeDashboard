/**
 * The two server-to-server calls to the Hope Move platform's auth API.
 *
 * Both are authenticated with `HOPE_CLIENT_ID` / `HOPE_CLIENT_SECRET`
 * and must therefore only ever run on the server. The secret is not
 * `NEXT_PUBLIC_`-prefixed, so Next would inline `undefined` rather than
 * leak it if this were imported into client code — but that produces a
 * confusing 401 instead of an obvious error, hence the explicit guard.
 *
 * Kept free of `node:` imports so `src/auth.ts` stays Edge-safe: only
 * `fetch` is used, which the Edge runtime provides.
 *
 * Nothing here logs a token, a code or the secret. An auth code is a
 * bearer credential for the seconds it lives, and logs outlive it.
 */

import {
    type HopeTokenResponse,
    parseTokenResponse,
} from "@/lib/auth/hope-token";

if (typeof window !== "undefined") {
    throw new Error("hope-exchange.ts must not be imported in browser code");
}

/**
 * How long to wait on the platform before giving up.
 *
 * This runs inside a sign-in, so a hung platform must fail fast enough
 * to show the facilitator a page rather than a spinner.
 */
const TIMEOUT_MS = 10_000;

export type HopeConfig = {
    apiUrl: string;
    clientId: string;
    clientSecret: string;
};

/** `null` when the integration is not configured, which is the normal
 *  state locally — hand-off sign-in still works without it. */
export function hopeConfig(): HopeConfig | null {
    const apiUrl = process.env.HOPE_API_URL?.trim().replace(/\/+$/, "");
    const clientId = process.env.HOPE_CLIENT_ID?.trim();
    const clientSecret = process.env.HOPE_CLIENT_SECRET?.trim();
    if (!apiUrl || !clientId || !clientSecret) return null;
    return { apiUrl, clientId, clientSecret };
}

async function postJson(
    config: HopeConfig,
    path: string,
    body: Record<string, string>,
): Promise<unknown | null> {
    let res: Response;
    try {
        res = await fetch(`${config.apiUrl}${path}`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                Accept: "application/json",
                // Node's fetch defaults Accept-Language to `*`, which the
                // platform feeds to .NET CultureInfo — and `*` is not a
                // culture, so every authenticated call 500s with
                // CultureNotFoundException before reaching the exchange
                // logic. A real locale sidesteps it; browsers always send
                // one, which is why only server-to-server calls hit this.
                "Accept-Language": "en-GB",
                "X-Client-Id": config.clientId,
                "X-Client-Secret": config.clientSecret,
            },
            body: JSON.stringify(body),
            signal: AbortSignal.timeout(TIMEOUT_MS),
            // A credential exchange must never be served from a cache.
            cache: "no-store",
        });
    } catch (err) {
        // Network-level failure: unreachable host, DNS, TLS, timeout.
        // Distinguished from an HTTP error below because the fixes differ.
        console.error(
            `hope auth: ${path} unreachable — ${(err as Error).message}`,
        );
        return null;
    }

    if (!res.ok) {
        // Status only. The body of a failed auth call can echo the code.
        console.warn(`hope auth: ${path} returned ${res.status}`);
        return null;
    }

    try {
        return await res.json();
    } catch {
        console.error(`hope auth: ${path} returned a non-JSON body`);
        return null;
    }
}

/** Trade a one-time authorization code for a token pair. */
export async function exchangeCode(
    config: HopeConfig,
    code: string,
    nowMs: number = Date.now(),
): Promise<HopeTokenResponse | null> {
    const body = await postJson(config, "/api/auth/exchange", { code });
    return body === null ? null : parseTokenResponse(body, nowMs);
}

/**
 * Trade a refresh token for a new pair.
 *
 * The platform rotates the refresh token, so the caller must store what
 * comes back and discard what it sent — reusing the old one fails.
 */
export async function refreshTokens(
    config: HopeConfig,
    refreshToken: string,
    nowMs: number = Date.now(),
): Promise<HopeTokenResponse | null> {
    const body = await postJson(config, "/api/auth/refresh", { refreshToken });
    return body === null ? null : parseTokenResponse(body, nowMs);
}
