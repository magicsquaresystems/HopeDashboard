/**
 * Whether a session may still act on the facilitator's behalf.
 *
 * Pure, and separate from `facilitator.ts`, because the rule it encodes
 * is a security decision that has to be readable and testable on its
 * own.
 *
 * The bug it fixes: the gate used to check `session.user.email` and
 * nothing else. `proxy.ts` excludes `/api`, so once a facilitator's link
 * to Hope died, every API route kept serving them for the remaining life
 * of the cookie — up to thirty days — reading live participant data with
 * credentials the platform had already stopped honouring.
 *
 * `hopeUserId` is what makes the three cases separable. It is set when a
 * session was minted through the platform and survives a refresh
 * failure, while `token.hope` is deleted and `error` is set. So:
 *
 *   - no `hopeUserId`, no error   → hand-off sign-in. Always allowed;
 *                                    it never had a platform link to
 *                                    lose, and it is the normal local
 *                                    and test path.
 *   - `hope_not_configured`       → the deployment has no platform
 *                                    integration. An operator state, not
 *                                    a failed login, so it is allowed.
 *   - `hope_refresh_failed`       → the platform refused to renew this
 *                                    facilitator's access. Refused here.
 *
 * The copy for that last case names the way back in, which is opening
 * the Hub from the Facilitator Dashboard again. It deliberately does not
 * say "sign in", because there is no sign-in form to go to — this
 * dashboard is only ever entered from Hope.
 */

export type SessionGateResult =
    | { ok: true; email: string }
    | { ok: false; status: number; code: string; detail: string };

/** The fields of a NextAuth session this decision reads. */
export type GateableSession = {
    user?: { email?: string | null } | null;
    error?: string;
} | null;

export const HOPE_SESSION_EXPIRED_DETAIL =
    "Your session with Hope has ended. Open the Insights Hub again from " +
    "your Facilitator Dashboard to carry on.";

export function gateFacilitatorSession(
    session: GateableSession,
): SessionGateResult {
    const email = session?.user?.email?.toLowerCase();
    if (!email) {
        return {
            ok: false,
            status: 401,
            code: "auth_required",
            detail: "Not signed in",
        };
    }

    // Checked after the email so a session that is BOTH broken and
    // anonymous still reports the plainer problem first.
    if (session?.error === "hope_refresh_failed") {
        return {
            ok: false,
            status: 401,
            code: "hope_session_expired",
            detail: HOPE_SESSION_EXPIRED_DETAIL,
        };
    }

    return { ok: true, email };
}
