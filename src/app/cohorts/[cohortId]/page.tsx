import { notFound, redirect } from "next/navigation";

import { auth } from "@/auth";
import { gateFacilitatorSession } from "@/lib/auth/session-gate";
import { resolveHopeMoveUrl } from "@/lib/hope-move-url";
import { exitPath } from "@/lib/session-redirect";
import {
    cohortsForFacilitator,
    isAssigned,
    resolveCohort,
} from "@/lib/server/assignments";
import {
    isPostingAllowedFor,
    postingPolicy,
} from "@/lib/server/posting-policy";
import { CohortSessionReset } from "@/components/cohort-session-reset";
import { NoticeBar } from "@/components/notice-bar";
import { Topbar } from "@/components/topbar";
import { WeekSelector } from "@/components/week-selector";
import { Queue } from "./queue";
import { Detail } from "./detail";
import { Drafts } from "./drafts";
import { CohortGrid } from "./cohort-grid";

export default async function CohortDashboard({
    params,
}: {
    params: Promise<{ cohortId: string }>;
}) {
    const { cohortId } = await params;
    const cohort = await resolveCohort(Number(cohortId));
    if (!cohort) notFound();

    // 404 rather than 403 for an unassigned cohort: a facilitator who
    // isn't on this programme has no business learning that it exists,
    // and "forbidden" confirms it does. `proxy.ts` has already ensured
    // there is a session by the time this renders.
    const session = await auth();
    // A dead platform link is not a missing cohort. `notFound()` here
    // would tell a facilitator the programme does not exist when the
    // real answer is that their session ended — and since cohort access
    // fails closed to an empty list, every cohort would 404 at once.
    const gate = gateFacilitatorSession(session);
    if (!gate.ok) {
        redirect(
            exitPath(
                resolveHopeMoveUrl(),
                gate.code === "hope_session_expired",
            ),
        );
    }
    if (!isAssigned(await cohortsForFacilitator(gate.email), cohort.id)) {
        notFound();
    }

    // Resolved on the server, per cohort, and handed down as a prop.
    // The Send button must never appear for a cohort the route would
    // refuse: a button that exists only to explain itself is worse than
    // no button. `hopeLinked` is checked too — a hand-off session has no
    // platform credentials, so it could only ever produce a 503.
    const publishEnabled =
        isPostingAllowedFor(postingPolicy(), {
            id: cohort.id,
            code: cohort.code,
        }) && session?.hopeLinked === true;

    return (
        <main className="flex w-full flex-1 flex-col">
            {/* The page's only h1. Visually redundant — the topbar already
                shows the cohort code — but without it the heading outline
                starts at h3 ("Follow-up queue") and a screen-reader user
                gets no page-level title to orient from. */}
            <h1 className="sr-only">
                Participant Insights Hub, cohort {cohort.code}
            </h1>
            <CohortSessionReset cohortId={cohort.id} />
            {/* One always-mounted live region for the whole page. Queue
                writes fail inside mutation callbacks, far from anywhere
                that could render a message, and the same failure can be
                triggered from the queue, the detail panel or the drafts
                column. */}
            <NoticeBar />
            <Topbar cohort={cohort} />
            <div className="border-b border-border bg-surface-2/40 px-4 py-2 sm:px-5">
                <WeekSelector
                    cohortId={cohort.id}
                    programmeLengthDays={cohort.programmeLengthDays}
                    programmeLengthKnown={cohort.programmeLengthKnown ?? true}
                    effectiveStart={cohort.effectiveStart}
                />
            </div>
            <CohortGrid
                queue={<Queue cohort={cohort} />}
                detail={
                    <Detail cohortId={cohort.id} cohortCode={cohort.code} />
                }
                drafts={
                    <Drafts cohort={cohort} publishEnabled={publishEnabled} />
                }
            />
        </main>
    );
}
