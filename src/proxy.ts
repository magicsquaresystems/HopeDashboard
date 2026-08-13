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
    if (!req.auth) {
        return Response.redirect(new URL("/login", req.nextUrl.origin));
    }
});

export const config = {
    // Everything except: API routes (self-gating, see above), Next's own
    // assets, `/enter` (the platform hand-off — requiring a session to
    // reach the route that creates one is a loop), the login fallback,
    // and static files.
    matcher: [
        "/((?!api|enter|_next/static|_next/image|favicon.ico|login|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)",
    ],
};
