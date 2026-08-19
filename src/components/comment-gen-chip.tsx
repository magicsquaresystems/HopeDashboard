"use client";

import { Sparkles } from "lucide-react";

import { useCommentGenStatus } from "@/lib/hooks/api";

/**
 * Read-only chip naming the reply model, mirroring `RiskModelChip` for
 * the drafting half of the page.
 *
 * The risk panel has always announced its model; drafting only revealed
 * one *after* a generation succeeded, so a facilitator about to wait
 * minutes had no idea what was about to write, and a deployment serving
 * a stale adapter looked identical to a correct one.
 *
 * The wait is genuinely long. Measured on a T4: 16 s for a single forum
 * reply and 99–175 s for a three-persona activity set, because personas
 * and their policy retries decode one at a time. See docs/HOSTING.md §1.
 *
 * `model_loaded` carries the part that matters operationally. False
 * means the next request pays the adapter load — or, on hardware that
 * cannot host the adapter at all, never completes. Saying so beside the
 * name turns an unexplained spinner into an expected wait.
 *
 * Hides itself when the service is unreachable: the drafts panel
 * already renders an explicit "comment generation is offline" card, and
 * a second failure indicator would just be noise. `useGenerate`
 * invalidates this query on any generation failure so a stale cached
 * status cannot keep claiming a live model beside that card.
 */
export function CommentGenChip() {
    const status = useCommentGenStatus();
    if (!status.data) return null;

    const loaded = status.data.model_loaded;

    // The face states what a facilitator needs to decide whether to
    // wait; the model id stays available for whoever is checking which
    // adapter a deployment is serving, but it is not the headline.
    const tooltip = `Reply drafts are written by ${status.data.model_version}.`;

    return (
        <span
            title={tooltip}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-surface px-2 py-1 text-xs text-text-2"
        >
            <Sparkles className="h-3.5 w-3.5 text-muted" aria-hidden />
            {loaded === false ? (
                <span className="text-risk-md">
                    AI drafts warming up, the first one takes about a minute
                </span>
            ) : (
                <span className="font-medium">AI drafts ready</span>
            )}
        </span>
    );
}
