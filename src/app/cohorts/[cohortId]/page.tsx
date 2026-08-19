import { notFound } from "next/navigation";

import { auth } from "@/auth";
import {
    cohortsForFacilitator,
    isAssigned,
    resolveCohort,
} from "@/lib/server/assignments";
import { CohortSessionReset } from "@/components/cohort-session-reset";
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
    const email = session?.user?.email?.toLowerCase();
    if (!email) notFound();
    if (!isAssigned(await cohortsForFacilitator(email), cohort.id)) {
        notFound();
    }

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
            <Topbar cohort={cohort} />
            <div className="border-b border-border bg-surface-2/40 px-4 py-2 sm:px-5">
                <WeekSelector
                    programmeLengthDays={cohort.programmeLengthDays}
                    effectiveStart={cohort.effectiveStart}
                />
            </div>
            <CohortGrid
                queue={<Queue cohort={cohort} />}
                detail={<Detail cohortId={cohort.id} />}
                drafts={<Drafts cohort={cohort} />}
            />
        </main>
    );
}
