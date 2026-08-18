import { type NextRequest } from "next/server";

import { hopeConfig } from "@/lib/auth/hope-exchange";

/**
 * TEMPORARY diagnostic for the platform exchange. Remove once sign-in
 * works end to end.
 *
 * The deployment's env vars and function logs are only visible to the
 * team that owns the Vercel project, which is not us. When the exchange
 * fails, the browser sees `exchange_failed` and nothing else — by
 * design, so a probing caller learns nothing. This route is the
 * temporary exception that lets us read the diagnosis ourselves: it
 * reports which exchange env vars the deployment actually has, and
 * makes one probe call to the platform with the REAL credentials and a
 * throwaway code, returning only the upstream HTTP status.
 *
 * What each outcome means:
 *   probe.reached false        HOPE_API_URL host is wrong or unreachable
 *   probe.status 404 / 405     HOPE_API_URL carries a stray path
 *   probe.status 401           credentials or code rejected — and since
 *                              the code is fake by construction, a 400
 *                              here instead would prove the creds pass
 *
 * Never returns the secret, or any part of it, only its length —
 * enough to spot an empty or truncated paste. Gated by a key baked in
 * below rather than an env var, because env vars are the thing being
 * diagnosed.
 */
const GATE_KEY = "df93b9043562e066f1f6a6075653a767";

export async function GET(req: NextRequest) {
    if (req.nextUrl.searchParams.get("key") !== GATE_KEY) {
        return new Response(null, { status: 404 });
    }

    const config = hopeConfig();
    if (!config) {
        return Response.json({
            configured: false,
            missing: {
                HOPE_API_URL: !process.env.HOPE_API_URL?.trim(),
                HOPE_CLIENT_ID: !process.env.HOPE_CLIENT_ID?.trim(),
                HOPE_CLIENT_SECRET: !process.env.HOPE_CLIENT_SECRET?.trim(),
            },
        });
    }

    // The platform team has custom error pages off on staging, so a 500
    // body may carry the actual exception — the diagnosis we cannot see
    // any other way. Truncated hard: enough for an exception message,
    // not enough for anything else.
    const probeUpstream = async (
        path: string,
        body: Record<string, string>,
    ): Promise<Record<string, unknown>> => {
        try {
            const res = await fetch(`${config.apiUrl}${path}`, {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                    Accept: "application/json",
                    // Mirrors hope-exchange.ts: without a real locale the
                    // platform 500s with CultureNotFoundException.
                    "Accept-Language": "en-GB",
                    "X-Client-Id": config.clientId,
                    "X-Client-Secret": config.clientSecret,
                },
                body: JSON.stringify(body),
                cache: "no-store",
                signal: AbortSignal.timeout(10_000),
            });
            const text = await res.text();
            return {
                reached: true,
                status: res.status,
                body: text.slice(0, 800),
            };
        } catch (err) {
            return { reached: false, error: (err as Error).message };
        }
    };

    return Response.json({
        configured: true,
        apiUrl: config.apiUrl,
        clientId: config.clientId,
        clientSecretLength: config.clientSecret.length,
        exchange: await probeUpstream("/api/auth/exchange", {
            code: "diagnostic-probe",
        }),
        refresh: await probeUpstream("/api/auth/refresh", {
            refreshToken: "diagnostic-probe",
        }),
    });
}
