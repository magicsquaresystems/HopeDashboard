"use client";

import { Skeleton } from "@/components/ui/skeleton";
import { useQueueLayoutStore } from "@/lib/store/queueLayoutStore";

/**
 * Route-level loading state for the cohort workspace.
 *
 * Reads the same persisted collapse flag the real grid does. Hardcoding
 * the expanded rail meant that once a facilitator collapsed the queue,
 * every cohort they opened reserved 18rem and then snapped to 2.5rem —
 * a permanent jump on the way into every page.
 */
export default function CohortLoading() {
    const collapsed = useQueueLayoutStore((s) => s.collapsed);
    const gridCols = collapsed
        ? "lg:grid-cols-[2.5rem_1fr] xl:grid-cols-[2.5rem_1fr_22rem]"
        : "lg:grid-cols-[18rem_1fr] xl:grid-cols-[18rem_1fr_22rem]";

    return (
        <main className="flex w-full flex-1 flex-col">
            {/* Topbar: gradient hairline, then a row that wraps to two
                lines below lg exactly as the real one does. */}
            <div className="border-b border-border bg-surface">
                <div className="h-0.5 bg-linear-to-r from-brand-a to-brand-b" />
                <div className="flex flex-col gap-3 px-4 py-3 sm:px-5 lg:flex-row lg:flex-wrap lg:items-center lg:gap-4">
                    <Skeleton className="h-7 w-64" />
                    <div className="flex flex-wrap gap-2 lg:ml-auto">
                        <Skeleton className="h-8 w-32" />
                        <Skeleton className="h-8 w-28" />
                        <Skeleton className="h-8 w-40" />
                    </div>
                </div>
            </div>
            {/* Week bar: same token and padding as the real one. */}
            <div className="border-b border-border bg-surface-2/40 px-4 py-2 sm:px-5">
                <Skeleton className="h-7 w-80" />
            </div>
            <div
                className={`grid flex-1 grid-cols-1 gap-4 px-4 py-4 sm:px-5 ${gridCols}`}
            >
                <Skeleton className="h-96 w-full" />
                <Skeleton className="h-96 w-full" />
                <Skeleton className="h-96 w-full lg:col-span-full xl:col-span-1" />
            </div>
        </main>
    );
}
