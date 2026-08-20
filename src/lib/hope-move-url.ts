/**
 * Where "back to the Facilitator Dashboard" points.
 *
 * Read on the server, then handed to the client tree by the root layout
 * (see `providers.tsx`). Note what that means: the resolved URL travels
 * to the browser in the RSC payload of every page, including the
 * signed-out one. That is fine for a public dashboard origin and is the
 * whole point of resolving it here, but it is not "the value never
 * leaves the server" — only `HOPE_API_URL` itself stays server-side.
 *
 * The fallback also assumes the platform's API base and its browser
 * origin are the same host, which is true for this deployment. A
 * deployment that reaches the platform over a private address would
 * need `NEXT_PUBLIC_HOPE_MOVE_URL` set explicitly, or it would render a
 * confident link to somewhere a facilitator's browser cannot go.
 *
 * The fallback matters more than the override. A deployment that talks
 * to the platform at all necessarily has `HOPE_API_URL`, and the
 * facilitator dashboard always lives at the same path on it, so the way
 * home can be derived rather than configured. Relying on
 * `NEXT_PUBLIC_HOPE_MOVE_URL` alone meant one unset variable removed
 * every route back to the platform — including from the signed-out
 * page, which tells facilitators to "open the Hub from your Hope Move
 * dashboard" and then offered no way to reach it.
 *
 * `NEXT_PUBLIC_HOPE_MOVE_URL` still wins when set, for a deployment
 * whose landing page is somewhere other than the facilitator dashboard.
 */
const FACILITATOR_DASHBOARD_PATH = "/modules/dashboard/facilitator";

export function resolveHopeMoveUrl(): string | null {
    const explicit = process.env.NEXT_PUBLIC_HOPE_MOVE_URL?.trim();
    if (explicit) return explicit;

    const apiUrl = process.env.HOPE_API_URL?.trim().replace(/\/+$/, "");
    if (!apiUrl) return null;

    return `${apiUrl}${FACILITATOR_DASHBOARD_PATH}`;
}
