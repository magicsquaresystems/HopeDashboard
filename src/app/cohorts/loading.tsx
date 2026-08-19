import { Skeleton } from "@/components/ui/skeleton";

/** Route-level loading state for the cohort picker — mirrors its
 *  header + card-grid proportions so the swap to content is calm. */
export default function CohortsLoading() {
    return (
        <main className="mx-auto w-full max-w-5xl px-6 py-10">
            <div className="mb-8 space-y-2">
                <Skeleton className="h-7 w-40" />
                <Skeleton className="h-4 w-72" />
            </div>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {[0, 1, 2].map((i) => (
                    <Skeleton key={i} className="h-32 w-full" />
                ))}
            </div>
        </main>
    );
}
