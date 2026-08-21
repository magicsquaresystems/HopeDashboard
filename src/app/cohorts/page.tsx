import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { CohortList } from "@/components/cohort-list";
import { HopeMoveLink } from "@/components/hope-move-link";
import { gateFacilitatorSession } from "@/lib/auth/session-gate";
import { visibleCohorts } from "@/lib/server/assignments";

/**
 * Cohort picker, scoped to what the signed-in facilitator is assigned
 * to. `proxy.ts` guarantees a session before this renders; the redirect
 * is a belt-and-braces guard for direct server-side invocation.
 */
export default async function CohortsIndexPage() {
    const session = await auth();
    // The same rule the API routes enforce, so a page render and a fetch
    // can never disagree about whether this session still works. Without
    // it, a facilitator whose Hope link had died saw "No cohorts are
    // assigned to you" — `hopeCohorts()` fails closed to an empty list —
    // which blames the programme admin for a dead session and sends them
    // to ask for access they already have.
    const gate = gateFacilitatorSession(session);
    if (!gate.ok) {
        redirect(
            gate.code === "hope_session_expired"
                ? "/login?error=session_expired"
                : "/login",
        );
    }
    const email = gate.email;

    const cohorts = await visibleCohorts(email);

    return (
        <main className="mx-auto w-full max-w-5xl px-6 py-10">
            {/* The way back out, on the front door where it belongs —
                one level away from the work itself, so nobody leaves
                mid-draft by aiming for it. The topbar carries a quieter
                copy on the cohort page. */}
            <HopeMoveLink className="mb-6" />
            <header className="mb-8 flex items-center justify-between">
                <div>
                    <h1 className="text-2xl font-semibold text-text">
                        Cohorts
                    </h1>
                    <p className="text-sm text-muted">
                        {cohorts.length > 0
                            ? "Select a cohort to open the participant-support dashboard."
                            : "Nothing to show yet."}
                    </p>
                </div>
            </header>
            {cohorts.length === 0 ? (
                <div className="rounded-lg border border-dashed border-border px-4 py-10 text-center">
                    <p className="text-sm font-medium text-text-2">
                        No cohorts are assigned to {email}.
                    </p>
                    <p className="mt-1 text-xs text-muted">
                        Ask the programme admin to add you to a cohort. If
                        you have just been added, open the Insights Hub
                        again from your Facilitator Dashboard.
                    </p>
                </div>
            ) : (
                <CohortList cohorts={cohorts} />
            )}
        </main>
    );
}
