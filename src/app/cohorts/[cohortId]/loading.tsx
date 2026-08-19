import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading state for the cohort workspace — mirrors the
 *  topbar + week bar + three-column grid so the page doesn't flash
 *  from blank to dense. */
export default function CohortLoading() {
    return (
        <div>
            <div className="border-b border-border bg-surface px-4 py-3 sm:px-5">
                <Skeleton className="h-8 w-full max-w-2xl" />
            </div>
            <div className="border-b border-border bg-surface px-4 py-2.5 sm:px-5">
                <Skeleton className="h-6 w-72" />
            </div>
            <div className="grid grid-cols-1 gap-4 px-4 py-4 sm:px-5 lg:grid-cols-[18rem_1fr] xl:grid-cols-[18rem_1fr_22rem]">
                <Skeleton className="h-96 w-full" />
                <Skeleton className="h-96 w-full" />
                <Skeleton className="h-96 w-full lg:col-span-full xl:col-span-1" />
            </div>
        </div>
    );
}
