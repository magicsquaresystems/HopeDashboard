/**
 * Where "back to Hope Move" points.
 *
 * Server-only: `HOPE_API_URL` is not `NEXT_PUBLIC_`-prefixed, so it is
 * readable here and never in the browser. The root layout resolves this
 * once and hands the value to the client tree — see `providers.tsx`.
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
