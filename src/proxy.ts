import { auth } from "@/auth";

/**
 * Page-level sign-in gate. (Next 16 renamed `middleware.ts` to
 * `proxy.ts`; both are recognised, `proxy` is the current name.)
 *
 * Without this, an unauthenticated visitor gets a fully rendered
 * dashboard — real participant health data on screen — where every
 * write silently 401s at the proxy routes. The API routes stay
 * self-gating rather than being redirected here: a fetch that gets a
 * 302 to an HTML login page produces a confusing parse error, whereas
 * the 401 JSON they already return is what `classifyGenerateError` maps
 * to "sign in again".
 *
 * `auth.ts` is deliberately Edge-safe (the hand-off Credentials provider
 * only, no Node-only modules) so this stays a cheap JWT decode per
 * navigation.
 *
 * The redirect carries no `callbackUrl`: `/login` is an explainer, not a
 * sign-in form — the way back in is a fresh `/enter` link minted by the
 * platform, which decides the destination itself.
 */
export default auth((req) => {
    // Checked positively, not by existence. Auth.js populates `auth`
    // with an object carrying an `error` when the configuration is
    // wrong (a missing or rotated AUTH_SECRET, say), and a bare
    // `if (!req.auth)` treats that object as a valid session — the
    // fail-open reported as GHSA-8fpg-xm3f-6cx3. This deployment spent
    // days with AUTH_SECRET unset, so that is not a hypothetical shape.
    // The library is patched (beta.32) and this does not rely on it:
    // a session is only a session when it names someone.
    const signedIn = Boolean(req.auth?.user?.email);
    if (!signedIn) {
        return Response.redirect(new URL("/login", req.nextUrl.origin));
    }

    // A session whose platform link has broken is worse than no session:
    // it renders a working-looking dashboard where the cohort list has
    // quietly emptied, because the credentials behind it are gone. The
    // `jwt` callback sets this when a refresh fails, and the only fix is
    // to go back to Hope Move for a new code — so say that rather than
    // letting them wonder where their cohorts went.
    if (req.auth?.error === "hope_refresh_failed") {
        return Response.redirect(
            new URL("/login?error=session_expired", req.nextUrl.origin),
        );
    }
});

export const config = {
    // Everything except: API routes (self-gating, see above), Next's own
    // assets, the two sign-in doors, the login fallback, and static files.
    //
    // `/enter` and `/auth/callback` are both exempt for the same reason —
    // requiring a session to reach the route that creates one is a loop.
    // Miss either and the symptom is a redirect to `/login` that looks
    // like the platform sent a bad link.
    matcher: [
        "/((?!api|enter|auth/callback|_next/static|_next/image|favicon.ico|login|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
    ],
};
