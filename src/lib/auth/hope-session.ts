/**
 * Reading the Hope tokens back out of the session, server-side only.
 *
 * The tokens live inside the Auth.js session JWT (see `src/auth.ts`),
 * which is a JWE-encrypted HttpOnly cookie. That placement is deliberate:
 * one cookie, one lifetime, and signing out disposes of the platform
 * credentials along with the session.
 *
 * It does mean `auth()` cannot hand them over. `auth()` returns the
 * object built by the `session` callback, and that same object is served
 * to the browser by `/api/auth/session` — so anything put there is
 * public. `getToken` reads the underlying JWT instead, which never
 * leaves the server.
 *
 * Deliberately not imported by `src/auth.ts`: that module is pulled into
 * Edge middleware, and `next/headers` does not belong there.
 */

import { headers } from "next/headers";
import { getToken } from "next-auth/jwt";

import type { HopeTokens } from "@/lib/auth/hope-token";
import {
    classifyHopeLink,
    type HopeLinkState,
    type LinkableJwt,
} from "@/lib/auth/hope-link";

if (typeof window !== "undefined") {
    throw new Error("hope-session.ts must not be imported in browser code");
}

export type HopeSession = {
    hopeUserId: string;
    tokens: HopeTokens;
};

/**
 * Auth.js prefixes the session cookie with `__Secure-` when it resolves
 * its own URL as HTTPS, and `getToken` needs to be told which name to
 * look under. Rather than re-deriving that decision — which depends on
 * `AUTH_URL`, proxy headers and `trustHost`, and would drift from
 * Auth.js the moment any of them changed — try both. A miss is a cheap
 * failed cookie lookup, not a failed decrypt.
 */
async function readSessionJwt(): Promise<Record<string, unknown> | null> {
    const secret = process.env.AUTH_SECRET;
    if (!secret) return null;

    const req = { headers: await headers() };
    for (const secureCookie of [true, false]) {
        const token = await getToken({ req, secret, secureCookie });
        if (token) return token as Record<string, unknown>;
    }
    return null;
}

/**
 * The current facilitator's platform credentials, or `null` when they
 * signed in by hand-off instead — which is the normal case locally and
 * must stay a supported path, not an error.
 *
 * The access token returned here has already been refreshed if it needed
 * to be: that happens in the `jwt` callback, which runs before this can
 * observe the token.
 */
export async function hopeSession(): Promise<HopeSession | null> {
    const { session } = await hopeSessionState();
    return session;
}

/**
 * The same read, but saying WHY there is no session.
 *
 * `hopeSession()` returns `null` for a hand-off sign-in and for a
 * platform sign-in whose refresh has failed, and callers that make
 * access decisions have to tell those apart — see `hope-link.ts` for
 * what conflating them cost.
 */
export async function hopeSessionState(): Promise<{
    state: HopeLinkState;
    session: HopeSession | null;
}> {
    const jwt = await readSessionJwt();
    const state = classifyHopeLink(jwt as LinkableJwt);
    if (state !== "linked") return { state, session: null };

    // Narrowing only — `classifyHopeLink` has already established that
    // every field is present and of the right type.
    const hope = jwt!.hope as HopeTokens;
    return {
        state,
        session: {
            hopeUserId: jwt!.hopeUserId as string,
            tokens: {
                accessToken: hope.accessToken,
                refreshToken: hope.refreshToken,
                expiresAt: hope.expiresAt,
            },
        },
    };
}
