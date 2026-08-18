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

    let probe: Record<string, unknown>;
    try {
        const res = await fetch(`${config.apiUrl}/api/auth/exchange`, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-Client-Id": config.clientId,
                "X-Client-Secret": config.clientSecret,
            },
            body: JSON.stringify({ code: "diagnostic-probe" }),
            cache: "no-store",
            signal: AbortSignal.timeout(10_000),
        });
        probe = { reached: true, status: res.status };
    } catch (err) {
        probe = { reached: false, error: (err as Error).message };
    }

    return Response.json({
        configured: true,
        apiUrl: config.apiUrl,
        clientId: config.clientId,
        clientSecretLength: config.clientSecret.length,
        probe,
    });
}
