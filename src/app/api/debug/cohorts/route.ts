import { type NextRequest } from "next/server";

import { hopeConfig } from "@/lib/auth/hope-exchange";
import { hopeSession } from "@/lib/auth/hope-session";

/**
 * TEMPORARY diagnostic for the cohort list. Remove once the platform
 * returns cohorts for a signed-in facilitator.
 *
 * Sign-in works, but the cohort page is empty for a facilitator the
 * platform's own My Modules page shows as assigned. Whatever
 * `/api/dashboard/cohorts` actually answers is swallowed on the way to
 * the page: `hope-cohorts.ts` fails closed to an empty list, correctly,
 * and the detail lands in Vercel logs we cannot read. This route
 * replays the same call with the same session token and hands back the
 * status and body.
 *
 * Doubly gated: the baked-in key, and a session that actually carries
 * platform credentials — it is reachable only from a browser that has
 * already signed in through the platform, and it returns cohort names
 * that facilitator is entitled to see anyway. The access token itself
 * is never included in the response.
 */
const GATE_KEY = "fda9d534ce5c5eb6d168ca1aa330dff8";

export async function GET(req: NextRequest) {
    if (req.nextUrl.searchParams.get("key") !== GATE_KEY) {
        return new Response(null, { status: 404 });
    }

    const config = hopeConfig();
    if (!config) {
        return Response.json({ error: "integration not configured" });
    }

    const session = await hopeSession();
    if (!session) {
        return Response.json({
            error: "no platform-linked session — sign in via the platform first",
        });
    }

    // Three ways a legacy ASP.NET filter chain might want the token:
    // standard bearer; bearer plus the client credential pair the
    // exchange endpoints use; and the raw token with no scheme prefix.
    const variants: Record<string, Record<string, string>> = {
        bearer: {
            Authorization: `Bearer ${session.tokens.accessToken}`,
        },
        bearerPlusClient: {
            Authorization: `Bearer ${session.tokens.accessToken}`,
            "X-Client-Id": config.clientId,
            "X-Client-Secret": config.clientSecret,
        },
        rawToken: {
            Authorization: session.tokens.accessToken,
        },
    };

    const results: Record<string, unknown> = {};
    for (const [name, auth] of Object.entries(variants)) {
        try {
            const res = await fetch(`${config.apiUrl}/api/dashboard/cohorts`, {
                headers: {
                    ...auth,
                    Accept: "application/json",
                    "Accept-Language": "en-GB",
                },
                cache: "no-store",
                signal: AbortSignal.timeout(10_000),
            });
            const text = await res.text();
            results[name] = { status: res.status, body: text.slice(0, 600) };
        } catch (err) {
            results[name] = { error: (err as Error).message };
        }
    }

    return Response.json({
        hopeUserId: session.hopeUserId,
        tokenExpiresInS: Math.round(
            (session.tokens.expiresAt - Date.now()) / 1000,
        ),
        results,
    });
}
