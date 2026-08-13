"use client";

import { useEffect, useState } from "react";
import {
    Info,
    Loader2,
    RefreshCcw,
    Send,
    Sparkles,
    ThumbsDown,
    ThumbsUp,
    Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { usePolishText } from "@/lib/hooks/api";
import { cn } from "@/lib/utils";
import type { Draft } from "@/lib/api/commentGen";

/**
 * Prototype-style draft card.
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ To: Jamie Cooper · in-app message    ⨂ Editable draft│
 *   ├──────────────────────────────────────────────────────┤
 *   │                                                      │
 *   │  Hi Jamie — your walking goal is still waiting on    │  ← directly
 *   │  its first step. Want to try one walk this week...   │     editable
 *   │                                                      │
 *   ├──────────────────────────────────────────────────────┤
 *   │ ↻  195 chars                              ⋮  ✈ Send  │
 *   └──────────────────────────────────────────────────────┘
 *
 *  - One card, one draft (the parent tabs switch which persona is active)
 *  - Body is a borderless inline textarea — no Edit button
 *  - Refresh icon at bottom-left → triggers regenerate via onRegenerate
 *  - Char counter next to it
 *  - Draft-quality feedback (👍/👎) is inline in the footer with a visible
 *    "Helpful?" prompt.
 *  - "What this draft is based on" disclosure stays below
 */

export type DraftContext = {
    topFactors: string[];
    lastActiveDays: number | null;
    memoryUsed: boolean;
    engagementUsed: boolean;
    displayName?: string;
    memorySnippets?: string[];
};

type DraftCardProps = {
    draft: Draft;
    onThumb: (draftId: string, label: "up" | "down") => void;
    onSend: (draftId: string, sentText: string, action: "accept" | "edit") => void;
    onRegenerate?: () => void;
    regenerating?: boolean;
    pending?: boolean;
    context?: DraftContext;
    /** Used in the "To: …" header. Falls back to "the participant" when
     *  the caller doesn't have a name. */
    recipientName?: string;
    /** Participant id for the Polish action (passed straight through to
     *  the comment-gen /text/polish endpoint). When omitted the Polish
     *  button is hidden — polish is a participant-scoped request. */
    participantId?: number;
};

// How long the "Restore my original" affordance stays visible after a
// successful polish. Long enough that a facilitator who didn't like
// the rephrase can roll back, short enough that the link doesn't
// linger in a stale state forever.
const POLISH_UNDO_MS = 10_000;

function isPersonalised(ctx: DraftContext): boolean {
    // Memory retrieval is the personalisation signal we trust — it
    // means the SLM had prior posts in its prompt. Profile bios used to
    // count here too but they're not available for cohort 1680.
    return ctx.memoryUsed;
}

export function DraftCard({
    draft,
    onThumb,
    onSend,
    onRegenerate,
    regenerating,
    pending,
    context,
    recipientName,
    participantId,
}: DraftCardProps) {
    const [text, setText] = useState(draft.body);
    const [edited, setEdited] = useState(false);
    const [thumb, setThumb] = useState<"up" | "down" | null>(null);

    // Polish-with-AI state. `polishShadow` holds the pre-polish text so a
    // facilitator can roll back if the rephrased version isn't what they
    // wanted. `polishError` surfaces a transient error pill if the call
    // fails (offline Space, timeout). Both clear on next Polish click.
    const [polishShadow, setPolishShadow] = useState<string | null>(null);
    const [polishError, setPolishError] = useState<string | null>(null);
    const polish = usePolishText();

    // No `reset state on draft change` effect: the parent already
    // remounts this component via `key={String(current.draft_id)}` when
    // the active persona changes or a new generation lands. useState
    // initialisers fire fresh on each mount, so state naturally resets
    // — no cascading-render anti-pattern required.

    // Auto-expire the "Restore my original" affordance after
    // POLISH_UNDO_MS so it doesn't linger forever.
    useEffect(() => {
        if (polishShadow === null) return;
        const t = setTimeout(() => setPolishShadow(null), POLISH_UNDO_MS);
        return () => clearTimeout(t);
    }, [polishShadow]);

    function clickPolish() {
        if (!participantId || text.trim().length < 8 || polish.isPending) return;
        setPolishError(null);
        const before = text;
        polish.mutate(
            {
                draft_text: before,
                participant_id: participantId,
                target_tone: "rephrase",
            },
            {
                onSuccess: (res) => {
                    setPolishShadow(before);
                    setText(res.text);
                    setEdited(true);
                },
                onError: (err) => setPolishError((err as Error).message),
            },
        );
    }

    function restoreOriginal() {
        if (polishShadow === null) return;
        setText(polishShadow);
        setPolishShadow(null);
        // Whether the original counted as an "edit" depends on whether
        // the facilitator had typed before — we keep `edited=true` if
        // they did, the parent's send-classification still treats this
        // as a facilitator-curated draft either way.
    }

    function clickThumb(label: "up" | "down") {
        setThumb(label);
        onThumb(String(draft.draft_id), label);
    }

    function clickSend() {
        const action = edited ? "edit" : "accept";
        onSend(String(draft.draft_id), text, action);
    }

    const toName = recipientName ?? context?.displayName ?? "the participant";
    const chars = text.length;

    return (
        <div className="space-y-3">
            <div className="overflow-hidden rounded-lg border border-border bg-surface">
                {/* Header: To: ... · in-app message  /  Editable draft */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2 text-xs">
                    <div className="text-text-2">
                        <span className="text-muted">To:</span>{" "}
                        <span className="font-medium text-text">{toName}</span>
                        <span className="ml-1.5 text-muted">
                            · in-app message
                        </span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-accent-ink">
                        <Sparkles className="h-3 w-3" aria-hidden />
                        Editable draft
                    </span>
                </div>

                {/* Body: directly editable */}
                <Textarea
                    rows={5}
                    value={text}
                    onChange={(e) => {
                        setText(e.target.value);
                        if (e.target.value !== draft.body) setEdited(true);
                    }}
                    disabled={pending || polish.isPending}
                    aria-label="Draft body"
                    className="rounded-none border-0 bg-transparent px-3 py-2.5 text-sm leading-relaxed text-text focus-visible:ring-0"
                />

                {(polishShadow !== null || polishError) && (
                    <div className="flex items-center justify-between gap-2 border-t border-border bg-surface-2/40 px-3 py-1.5 text-xs">
                        {polishError ? (
                            <span className="text-risk-hi" title={polishError}>
                                Polish failed — try again
                            </span>
                        ) : (
                            <span className="text-muted">
                                Polished by AI.
                            </span>
                        )}
                        {polishShadow !== null && (
                            <button
                                type="button"
                                onClick={restoreOriginal}
                                className="text-accent-ink hover:underline"
                            >
                                Restore my original
                            </button>
                        )}
                    </div>
                )}

                {/* Footer: refresh + chars  /  helpful? + kebab + Send */}
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2">
                    <div className="flex items-center gap-2 text-xs text-muted">
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={onRegenerate}
                            disabled={!onRegenerate || pending || regenerating}
                            aria-label="Regenerate drafts"
                            title="Regenerate drafts"
                            className="h-7 w-7"
                        >
                            <RefreshCcw
                                className={cn(
                                    "h-3.5 w-3.5",
                                    regenerating && "animate-spin",
                                )}
                            />
                        </Button>
                        {participantId !== undefined && (
                            <Button
                                variant="ghost"
                                size="icon"
                                onClick={clickPolish}
                                disabled={
                                    pending ||
                                    polish.isPending ||
                                    text.trim().length < 8
                                }
                                aria-label="Polish with AI"
                                title="Fix spelling, grammar, and rephrase for clarity"
                                className="h-7 w-7"
                            >
                                {polish.isPending ? (
                                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                                ) : (
                                    <Wand2 className="h-3.5 w-3.5" />
                                )}
                            </Button>
                        )}
                        <span>{chars} chars</span>
                        {context && isPersonalised(context) && (
                            <span
                                className="inline-flex items-center gap-1 text-accent-ink"
                                title="Memory + profile context applied"
                            >
                                <Sparkles className="h-3 w-3" aria-hidden />
                                Personalised
                            </span>
                        )}
                    </div>
                    <div className="flex items-center gap-1">
                        {/* Inline draft-quality feedback, visible and
                            labelled. The signal feeds the HITL improvement
                            loop. */}
                        <span className="mr-0.5 text-[11px] text-muted">
                            {thumb ? "Thanks!" : "Helpful?"}
                        </span>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => clickThumb("up")}
                            disabled={pending}
                            aria-label="Mark this draft as a good reply"
                            aria-pressed={thumb === "up"}
                            title="Good reply — tells the system to suggest more like this"
                            className={cn(
                                "h-7 w-7 text-muted hover:text-risk-lo",
                                thumb === "up" && "text-risk-lo",
                            )}
                        >
                            <ThumbsUp className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => clickThumb("down")}
                            disabled={pending}
                            aria-label="Mark this draft as a poor reply"
                            aria-pressed={thumb === "down"}
                            title="Not useful — helps improve future AI drafts"
                            className={cn(
                                "h-7 w-7 text-muted hover:text-risk-hi",
                                thumb === "down" && "text-risk-hi",
                            )}
                        >
                            <ThumbsDown className="h-3.5 w-3.5" />
                        </Button>
                        <Button
                            size="sm"
                            onClick={clickSend}
                            disabled={pending || !text.trim()}
                            className="gap-1.5"
                        >
                            <Send className="h-3.5 w-3.5" aria-hidden />
                            Send
                        </Button>
                    </div>
                </div>
            </div>

            {context && (
                <details className="text-xs text-muted">
                    <summary className="inline-flex cursor-pointer select-none items-center gap-1.5 text-text-2">
                        <Info className="h-3 w-3" aria-hidden />
                        What this draft is based on
                    </summary>
                    <div className="mt-2 space-y-1.5 rounded-md border border-border bg-surface-2 p-2.5 leading-relaxed">
                        <div>
                            <span className="font-medium text-text-2">
                                Persona:
                            </span>{" "}
                            {draft.persona} — {draft.label}
                        </div>
                        {context.topFactors.length > 0 && (
                            <div>
                                <span className="font-medium text-text-2">
                                    Top signals:
                                </span>{" "}
                                {context.topFactors.slice(0, 2).join("; ")}
                            </div>
                        )}
                        {context.lastActiveDays !== null && (
                            <div>
                                <span className="font-medium text-text-2">
                                    Last active:
                                </span>{" "}
                                {context.lastActiveDays === 0
                                    ? "today"
                                    : `${context.lastActiveDays} day${
                                          context.lastActiveDays === 1 ? "" : "s"
                                      } ago`}
                            </div>
                        )}
                        <div>
                            <span className="font-medium text-text-2">
                                Memory hit:
                            </span>{" "}
                            {context.memoryUsed
                                ? "yes — prior posts retrieved"
                                : "no — cold-start"}
                        </div>
                        {context.memoryUsed &&
                            context.memorySnippets &&
                            context.memorySnippets.length > 0 && (
                                <ul className="mt-1 list-disc space-y-0.5 pl-5">
                                    {context.memorySnippets
                                        .slice(0, 3)
                                        .map((s, i) => (
                                            <li
                                                key={i}
                                                className="line-clamp-1 italic"
                                            >
                                                “{s}”
                                            </li>
                                        ))}
                                </ul>
                            )}
                        <div>
                            <span className="font-medium text-text-2">
                                Engagement context:
                            </span>{" "}
                            {context.engagementUsed
                                ? "applied"
                                : "not available"}
                        </div>
                        <p className="mt-1.5 italic">
                            Drafts are suggestions. Always review before sending.
                        </p>
                    </div>
                </details>
            )}
        </div>
    );
}
