"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { Search } from "lucide-react";

import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import type { CohortMeta } from "@/lib/cohorts";

/**
 * Searchable cohort picker.
 *
 * The list is already filtered to what this facilitator is assigned to
 * before it reaches the browser, so search is a convenience, not a
 * boundary. It earns its place for facilitators running several live
 * programmes at once — and will matter more once cohorts arrive from the
 * platform's weekly feed rather than a three-entry hardcoded registry.
 *
 * The input only appears above a handful of cards, since a search box
 * over three items is noise.
 */
const SEARCH_THRESHOLD = 4;

/** Inside the programme window right now — the cohort a facilitator is
 *  most likely here for.
 *
 *  A cohort whose length was never set has no window to be inside, so
 *  it cannot be called live. Deriving one from the six-week fallback
 *  declared open-ended cohorts finished 42 days after they started,
 *  which both hid the badge and sank them down the ordering. */
function isLive(c: CohortMeta, nowMs: number): boolean {
    if (c.programmeLengthKnown === false) return false;
    const start = Date.parse(c.effectiveStart);
    if (!Number.isFinite(start)) return false;
    return start <= nowMs && nowMs < start + c.programmeLengthDays * 86_400_000;
}

export function CohortList({ cohorts }: { cohorts: CohortMeta[] }) {
    const [query, setQuery] = useState("");

    // Captured once on mount so render stays pure (react-hooks/purity):
    // liveness moves on the scale of days, so a stable per-visit value
    // is also the honest one — the badge should not flicker mid-visit.
    const [nowMs] = useState(() => Date.now());

    // Live programmes first, then most recent first. Registry order is
    // whatever the source happened to serve, which buries the current
    // cohort under finished ones as soon as the list grows.
    const ordered = useMemo(() => {
        return [...cohorts].sort((a, b) => {
            const liveDelta =
                Number(isLive(b, nowMs)) - Number(isLive(a, nowMs));
            if (liveDelta !== 0) return liveDelta;
            return Date.parse(b.effectiveStart) - Date.parse(a.effectiveStart);
        });
    }, [cohorts, nowMs]);

    const shown = useMemo(() => {
        const q = query.trim().toLowerCase();
        if (!q) return ordered;
        return ordered.filter(
            (c) =>
                c.code.toLowerCase().includes(q) ||
                c.moduleName.toLowerCase().includes(q) ||
                String(c.id).includes(q),
        );
    }, [ordered, query]);

    return (
        <>
            {cohorts.length >= SEARCH_THRESHOLD && (
                <div className="relative mb-5">
                    <Search
                        className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted"
                        aria-hidden
                    />
                    <input
                        type="search"
                        value={query}
                        onChange={(e) => setQuery(e.target.value)}
                        placeholder="Search cohorts by code or programme…"
                        aria-label="Search cohorts"
                        className="w-full rounded-md border border-border bg-surface py-2 pl-9 pr-3 text-sm text-text outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent-2"
                    />
                </div>
            )}

            {shown.length === 0 ? (
                <p className="rounded-lg border border-dashed border-border px-4 py-8 text-center text-sm text-muted">
                    No cohorts match “{query}”.
                </p>
            ) : (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {shown.map((c) => (
                        <Link key={c.id} href={`/cohorts/${c.id}`}>
                            <Card className="h-full transition-shadow hover:shadow">
                                <CardHeader>
                                    <CardTitle className="flex items-center justify-between gap-2">
                                        {c.code}
                                        {isLive(c, nowMs) && (
                                            <span className="rounded-full border border-accent px-2 py-0.5 text-[10px] font-medium text-accent">
                                                Live
                                            </span>
                                        )}
                                    </CardTitle>
                                    <CardDescription>
                                        {c.moduleName}
                                    </CardDescription>
                                </CardHeader>
                                <CardContent>
                                    <p className="text-xs text-muted">
                                        Cohort #{c.id} ·{" "}
                                        {/* Same rule as the week bar: only
                                            state a length the source
                                            actually gave us. */}
                                        {c.programmeLengthKnown === false
                                            ? "no end date set"
                                            : `${c.programmeLengthDays}-day programme`}
                                    </p>
                                </CardContent>
                            </Card>
                        </Link>
                    ))}
                </div>
            )}
        </>
    );
}
