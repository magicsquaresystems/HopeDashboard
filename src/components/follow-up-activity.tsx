"use client";

import { useMemo, useState, type FormEvent } from "react";
import { Mail, Plus, StickyNote } from "lucide-react";

import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useMemory } from "@/lib/hooks/api";
import { useNotesStore } from "@/lib/store/notesStore";
import type { MemoryEntry } from "@/lib/api/commentGen";

type FollowUpActivityProps = {
    participantId: string;
    cohortId: number;
};

type ActivityEntry = {
    id: string;
    ts: string;
    kind: "message" | "note";
    title: string;
    sub: string;
};

function memoryEntryToActivity(m: MemoryEntry): ActivityEntry | null {
    if (m.role !== "facilitator_reply") return null;
    return {
        id: String(m.memory_id ?? `${m.ts ?? ""}-${m.activity_id ?? ""}`),
        ts: m.ts ?? "",
        kind: "message",
        title: m.activity_type ? `Sent · ${m.activity_type}` : "Sent reply",
        sub: m.text ?? "",
    };
}

function timeAgo(ts: string): string {
    if (!ts) return "";
    const ms = Date.now() - new Date(ts).getTime();
    if (ms < 60_000) return "just now";
    const m = Math.floor(ms / 60_000);
    if (m < 60) return `${m}m ago`;
    const h = Math.floor(m / 60);
    if (h < 24) return `${h}h ago`;
    const d = Math.floor(h / 24);
    return `${d}d ago`;
}

export function FollowUpActivity({
    participantId,
    cohortId,
}: FollowUpActivityProps) {
    const memory = useMemory(participantId, cohortId);
    // Select the raw notes array (stable reference until the store
    // changes); map outside the selector. Zustand uses useSyncExternalStore
    // which infinite-loops if the selector returns a fresh array per render.
    const rawNotes = useNotesStore((s) => s.notes[participantId]);
    const addNote = useNotesStore((s) => s.addNote);
    const notes = useMemo<ActivityEntry[]>(
        () =>
            (rawNotes ?? []).map((n) => ({
                id: n.id,
                ts: n.ts,
                kind: "note",
                title: "Coach note added",
                sub: n.text,
            })),
        [rawNotes],
    );

    const [draftNote, setDraftNote] = useState("");

    function onAdd(e: FormEvent) {
        e.preventDefault();
        const text = draftNote.trim();
        if (!text) return;
        addNote(participantId, text);
        setDraftNote("");
    }

    const remoteActivity =
        memory.data
            ?.map(memoryEntryToActivity)
            .filter((x): x is ActivityEntry => x !== null) ?? [];
    const all = [...notes, ...remoteActivity].sort(
        (a, b) => new Date(b.ts).getTime() - new Date(a.ts).getTime(),
    );

    return (
        <Card className="p-0">
            <CardHeader className="flex flex-row items-center justify-between gap-2 pb-3">
                <CardTitle>Follow-up activity</CardTitle>
                <span className="text-xs text-muted">
                    {all.length} item{all.length === 1 ? "" : "s"}
                </span>
            </CardHeader>
            <CardContent className="flex flex-col p-0">
                {memory.isLoading ? (
                    <div className="space-y-2 px-4 pb-3">
                        <Skeleton className="h-10 w-full" />
                        <Skeleton className="h-10 w-full" />
                    </div>
                ) : (
                    <>
                        {/* Sent history failed to load. Kept distinct from the
                            "no follow-ups yet" empty state below — an
                            unreachable comment-gen must not read as an empty
                            history. Local notes are unaffected, so the list
                            still renders whatever we do have. */}
                        {memory.isError && (
                            <p
                                role="status"
                                className="px-4 pb-3 text-center text-xs text-risk-hi"
                            >
                                Couldn&apos;t load sent history — showing local
                                notes only.
                            </p>
                        )}
                        {all.length === 0 ? (
                            !memory.isError && (
                                <p className="px-4 pb-3 text-center text-xs text-muted">
                                    No follow-ups yet. Send a draft or add a
                                    note below.
                                </p>
                            )
                        ) : (
                            <ul className="flex flex-col">
                                {all.slice(0, 6).map((entry) => (
                                    <li
                                        key={entry.id}
                                        className="grid grid-cols-[24px_1fr_auto] items-center gap-2.5 border-b border-border px-4 py-2.5 last:border-b-0"
                                    >
                                        <span className="grid h-6 w-6 place-items-center rounded-md border border-border bg-surface-2 text-text-2">
                                            {entry.kind === "message" ? (
                                                <Mail
                                                    className="h-3.5 w-3.5"
                                                    aria-hidden
                                                />
                                            ) : (
                                                <StickyNote
                                                    className="h-3.5 w-3.5"
                                                    aria-hidden
                                                />
                                            )}
                                        </span>
                                        <div className="min-w-0">
                                            <div className="text-[13px] text-text">
                                                {entry.title}
                                            </div>
                                            <div className="line-clamp-1 text-[11.5px] text-muted">
                                                {entry.sub}
                                            </div>
                                        </div>
                                        <span className="text-[11.5px] text-muted tabular-nums">
                                            {timeAgo(entry.ts)}
                                        </span>
                                    </li>
                                ))}
                            </ul>
                        )}
                    </>
                )}
                <form
                    onSubmit={onAdd}
                    className="flex gap-2 border-t border-border px-4 py-3"
                >
                    <input
                        value={draftNote}
                        onChange={(e) => setDraftNote(e.target.value)}
                        placeholder="Add a note about this follow-up…"
                        aria-label="Add a note"
                        className="flex-1 rounded-md border border-border bg-surface px-2.5 py-1.5 text-xs text-text outline-none placeholder:text-muted focus:border-accent focus:ring-2 focus:ring-accent-2"
                    />
                    <button
                        type="submit"
                        title="Add note"
                        disabled={!draftNote.trim()}
                        className="grid h-7 w-7 place-items-center rounded-md border border-border bg-surface text-text-2 transition-colors hover:bg-surface-2 hover:text-text disabled:opacity-40"
                    >
                        <Plus className="h-3.5 w-3.5" aria-hidden />
                    </button>
                </form>
            </CardContent>
        </Card>
    );
}
