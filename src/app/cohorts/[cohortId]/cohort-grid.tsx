"use client";

import type { ReactNode } from "react";

import { useQueueLayoutStore } from "@/lib/store/queueLayoutStore";

/**
 * Three-column dashboard layout. The queue column collapses to a thin
 * rail (~2.5rem) when the facilitator clicks the collapse chevron in the
 * queue card header — useful when working deeply in the drafts panel and
 * you want more horizontal room for draft tabs and the participant post.
 * The Queue component reads the same store and renders a slim rail when
 * collapsed.
 */
export function CohortGrid({
    queue,
    detail,
    drafts,
}: {
    queue: ReactNode;
    detail: ReactNode;
    drafts: ReactNode;
}) {
    const collapsed = useQueueLayoutStore((s) => s.collapsed);
    const gridCols = collapsed
        ? "lg:grid-cols-[2.5rem_1fr] xl:grid-cols-[2.5rem_1fr_22rem]"
        : "lg:grid-cols-[18rem_1fr] xl:grid-cols-[18rem_1fr_22rem]";
    return (
        <div
            className={`grid flex-1 grid-cols-1 gap-4 px-4 py-4 sm:px-5 ${gridCols}`}
        >
            {queue}
            {detail}
            <div className="lg:col-span-full xl:col-span-1">{drafts}</div>
        </div>
    );
}
