import { type NextRequest } from "next/server";

/**
 * Compatibility door for `/api/auth/callback?code=…`.
 *
 * The platform sends facilitators here. The real handler is
 * `/auth/callback`, which is deliberately outside `/api` so `proxy.ts`
 * treats it as a navigation rather than a fetch — see the docblock
 * there.
 *
 * Without this route the request falls through to Auth.js's catch-all at
 * `/api/auth/[...nextauth]`, which reads it as a provider callback with
 * no provider named and answers "There was a problem with the server
 * configuration". That message points at env vars and sends whoever is
 * debugging it a long way in the wrong direction, which is most of the
 * reason this file exists rather than a note asking the platform to
 * change its URL.
 *
 * Only the exact path `/api/auth/callback` lands here. Auth.js's own
 * provider callbacks are one segment deeper — `/api/auth/callback/
 * hope-platform` — and still resolve to its catch-all, because Next
 * matches this static route only when nothing follows it. That boundary
 * is load-bearing: shadow those and sign-in itself stops completing.
 */
export function GET(req: NextRequest) {
    const target = new URL("/auth/callback", req.nextUrl.origin);
    // Carry the query verbatim: `code`, and `state` once the platform
    // starts sending one.
    target.search = req.nextUrl.search;
    return Response.redirect(target, 307);
}
