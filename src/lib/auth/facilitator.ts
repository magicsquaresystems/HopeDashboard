import { auth } from "@/auth";
import { ApiError } from "@/lib/api/client";

/**
 * Server-side identity for API routes.
 *
 * Every write the dashboard makes on a facilitator's behalf — thumbs,
 * sends, queue snoozes — is attributed to the signed-in user, and the
 * attribution is stamped *here*, never accepted from the client. A
 * browser can put anything in a request body; the HITL feedback rows
 * this attribution lands in are training data for the next model and an
 * audit trail for outreach to a health cohort, so "whoever sent it said
 * so" is not a good enough provenance story.
 *
 * Throwing `ApiError` rather than returning a response keeps handlers
 * free of branching: `withApiErrors` (../../app/api/proxy/_errors.ts)
 * already turns it into a 401 whose status survives to the browser,
 * where `classifyGenerateError` maps it to "sign in again" instead of
 * the generic "service offline".
 *
 * Email is the identifier, not the NextAuth `id`. With the Credentials
 * provider on a JWT session, `session.user` carries `email` and `name`
 * but not `id` (the `sub` claim isn't surfaced without a custom
 * callback). Email is also what `FACILITATOR_EMAILS` gates on, so the
 * allowlist, the audit trail, and the cohort assignments all key on the
 * same string.
 */
export async function requireFacilitatorEmail(): Promise<string> {
    const session = await auth();
    const email = session?.user?.email?.toLowerCase();
    if (!email) {
        throw new ApiError(401, "Not signed in", "auth_required");
    }
    return email;
}
