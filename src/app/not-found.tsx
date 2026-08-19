import Link from "next/link";

import { EmptyState } from "@/components/empty-state";
import { HopeMoveLink } from "@/components/hope-move-link";

/**
 * Branded 404 — reached for unknown routes AND for cohort ids the
 * signed-in facilitator isn't assigned to. Deliberately does not
 * distinguish the two: the cohort page answers "unknown" and
 * "unassigned" identically so a probing URL can't map which cohorts
 * exist (see cohorts/[cohortId]/page.tsx). The copy therefore covers
 * both readings honestly.
 */
export default function NotFound() {
    return (
        <main className="flex flex-1 items-center justify-center px-4 py-16">
            <div className="w-full max-w-md space-y-4">
                <EmptyState
                    title="We can't find that page"
                    description="The link may be out of date, or this cohort may not be assigned to you. Your cohort list has everything you can open."
                >
                    <Link
                        href="/cohorts"
                        className="inline-block rounded-md bg-text px-4 py-2 text-sm font-medium text-surface"
                    >
                        Go to your cohorts
                    </Link>
                </EmptyState>
                <div className="text-center">
                    <HopeMoveLink />
                </div>
            </div>
        </main>
    );
}
