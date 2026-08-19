"use client";

import { useEffect, useRef, useState } from "react";
import {
    Check,
    Copy,
    Info,
    Loader2,
    RefreshCcw,
    Sparkles,
    ThumbsDown,
    ThumbsUp,
    Wand2,
} from "lucide-react";

import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { useCopyToClipboard } from "@/lib/hooks/useCopyToClipboard";
import { usePolishText } from "@/lib/hooks/api";
import { cn } from "@/lib/utils";
import type { Draft } from "@/lib/api/commentGen";

/**
 * Prototype-style draft card.
 *
 *   ┌──────────────────────────────────────────────────────┐
 *   │ To: Jamie Cooper · paste into Hope Move  ⨂ Editable  │
 *   ├──────────────────────────────────────────────────────┤
 *   │                                                      │
 *   │  Hi Jamie — your walking goal is still waiting on    │  ← directly
 *   │  its first step. Want to try one walk this week...   │     editable
 *   │                                                      │
 *   ├──────────────────────────────────────────────────────┤
 *   │ ↻  195 chars                        ⋮  ⧉ Copy reply  │
 *   └──────────────────────────────────────────────────────┘
 *
 *  - One card, one draft (the parent tabs switch which persona is active)
 *  - Body is a borderless inline textarea — no Edit button
 *  - Refresh icon at bottom-left → triggers regenerate via onRegenerate
 *  - Char counter next to it
 *  - Draft-quality feedback (👍/👎) is inline in the footer with a visible
 *    "Helpful?" prompt.
 *  - "What this draft is based on" disclosure stays below
 *
 * On "Copy reply" rather than "Send": this dashboard cannot deliver a
 * message to a participant yet — the platform's publish endpoint exists
 * but is switched off pending a safe test cohort. The previous Send
 * button recorded the research event and marked the participant
 * contacted while delivering nothing, which is a lie with clinical
 * consequences. Copying is an action that genuinely happens, so it is
 * what the button claims — and `onUse` (the research record + contacted
 * marker) fires only after the clipboard write actually succeeds.
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
    /** Fired after the reply text has actually reached the clipboard —
     *  the caller records the research event and marks the participant
     *  contacted, so this must never fire on a failed copy. */
    onUse: (draftId: string, sentText: string, action: "accept" | "edit") => void;
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
    onUse,
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
    const bodyRef = useRef<HTMLTextAreaElement>(null);
    const clipboard = useCopyToClipboard();

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

    async function clickCopy() {
        const ok = await clipboard.copy(text);
        if (ok) {
            // Only a real copy counts as using the draft — this is what
            // records the research event and marks the participant
            // contacted for colleagues.
            onUse(String(draft.draft_id), text, edited ? "edit" : "accept");
        } else {
            // Clipboard refused (permissions, insecure context). Select
            // the text so one keystroke finishes the job, and say so.
            bodyRef.current?.focus();
            bodyRef.current?.select();
        }
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
                            · paste into Hope Move
                        </span>
                    </div>
                    <span className="inline-flex items-center gap-1 text-accent-ink">
                        <Sparkles className="h-3 w-3" aria-hidden />
                        Editable draft
                    </span>
                </div>

                {/* Body: directly editable */}
                <Textarea
                    ref={bodyRef}
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
                            onClick={clickCopy}
                            disabled={pending || !text.trim()}
                            className="gap-1.5"
                        >
                            {clipboard.copied ? (
                                <Check className="h-3.5 w-3.5" aria-hidden />
                            ) : (
                                <Copy className="h-3.5 w-3.5" aria-hidden />
                            )}
                            {clipboard.copied ? "Copied" : "Copy reply"}
                        </Button>
                    </div>
                </div>

                {/* Always-mounted polite region (a display:none live
                    region is not announced); the styled line renders
                    only when there is something true to say. */}
                <div aria-live="polite">
                    {(clipboard.copied || clipboard.failed) && (
                        <p
                            className={cn(
                                "border-t border-border px-3 py-1.5 text-xs",
                                clipboard.failed
                                    ? "text-risk-md"
                                    : "text-risk-lo",
                            )}
                        >
                            {clipboard.failed
                                ? "Couldn't copy automatically. The text is selected, press Ctrl+C."
                                : `Copied. Paste it to ${toName} in Hope Move.`}
                        </p>
                    )}
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
                                Tone:
                            </span>{" "}
                            {draft.label}
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
                                Past posts:
                            </span>{" "}
                            {context.memoryUsed
                                ? "used, so the draft refers back to what they wrote before"
                                : "none used, this is a first draft for them"}
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
                                Activity signals:
                            </span>{" "}
                            {context.engagementUsed
                                ? "used"
                                : "not available"}
                        </div>
                        <p className="mt-1.5 italic">
                            Drafts are suggestions. Review before you paste
                            into Hope Move.
                        </p>
                    </div>
                </details>
            )}
        </div>
    );
}
