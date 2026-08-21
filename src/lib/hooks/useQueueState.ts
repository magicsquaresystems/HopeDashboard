"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { proxyFailure } from "@/lib/api/proxy-error";
import {
    friendlyQueueOpError,
    isQueueStateFatal,
} from "@/lib/queue-op-error";
import { useNoticeStore } from "@/lib/store/noticeStore";
import {
    applyOp,
    emptyQueueState,
    type CohortQueueState,
    type QueueOp,
} from "@/lib/queue-state-shared";

/**
 * Shared triage state, read and written through `/api/queue-state`.
 *
 * Polls on an interval because this is the one part of the dashboard
 * whose truth is changed by *other people*. Everything else is derived
 * from a bundle and a model; snoozes and contact markers are set by
 * whichever facilitator got there first, and a stale copy is exactly the
 * failure this feature exists to prevent — so 30 s is the ceiling on how
 * long two facilitators can unknowingly work the same participant.
 *
 * Mutations apply optimistically through the same pure `applyOp` the
 * server uses, so the local view matches what will come back.
 */
const POLL_MS = 30_000;

/**
 * Stop polling after this long without the facilitator touching
 * anything, even if the tab is still in front of them.
 *
 * A dashboard left open on a second monitor over lunch is the common
 * case, and it was reading the whole marker collection twice a minute
 * for hours. Firestore bills per document read and the free tier is
 * 50,000 a day, so an idle tab could exhaust a cohort's allowance and
 * take the shared markers down for everyone until midnight UTC —
 * paying, in reads, for a queue nobody was looking at.
 *
 * Coming back resumes it: any pointer, key or focus event marks the
 * session active again, and `refetchOnWindowFocus` catches up
 * immediately on return, so the first thing a returning facilitator
 * sees is current rather than however stale the pause left it.
 */
const IDLE_AFTER_MS = 5 * 60_000;

function queueStateKey(cohortId: number) {
    return ["queue-state", cohortId] as const;
}

/**
 * Whether anyone is actually watching.
 *
 * Module-level rather than per-hook: several components call
 * `useQueueState` for the same cohort and they should all agree, and
 * the listeners are cheap enough to attach once for the page's life.
 */
let lastInteractionAt = Date.now();

if (typeof window !== "undefined") {
    const touch = () => {
        lastInteractionAt = Date.now();
    };
    for (const event of ["pointerdown", "keydown", "focus", "visibilitychange"]) {
        window.addEventListener(event, touch, { passive: true });
    }
}

function someoneIsWatching(): boolean {
    if (typeof document === "undefined") return true;
    if (document.visibilityState === "hidden") return false;
    return Date.now() - lastInteractionAt < IDLE_AFTER_MS;
}

export function useQueueState(cohortId: number) {
    return useQuery({
        queryKey: queueStateKey(cohortId),
        queryFn: async (): Promise<CohortQueueState> => {
            const path = `/api/queue-state?cohortId=${cohortId}`;
            const res = await fetch(path);
            if (!res.ok) throw await proxyFailure(path, res);
            return res.json();
        },
        // An unreachable store shouldn't blank the queue's hidden list;
        // the previous value stays until a fetch succeeds.
        placeholderData: (prev) => prev,
        staleTime: 15_000,
        // Catch up the moment the facilitator comes back, which is what
        // makes pausing the poll safe: the gap is invisible because
        // returning to the tab refetches before they can read it.
        refetchOnWindowFocus: true,
        // Stop polling once the failure is one that cannot fix itself.
        // A missing store or an ended session fails identically every 30
        // seconds forever; continuing to ask buries the reason under
        // more failures and keeps a dead deployment looking busy.
        //
        // And stop while nobody is looking. The 30 s ceiling exists so
        // two facilitators do not work the same participant unknowingly
        // — a risk that only exists while someone is actually working.
        refetchInterval: (query) => {
            if (isQueueStateFatal(query.state.error)) return false;
            return someoneIsWatching() ? POLL_MS : false;
        },
        retry: (count, error) => !isQueueStateFatal(error) && count < 1,
    });
}

export function useQueueOp(cohortId: number) {
    const qc = useQueryClient();
    // Read off the store rather than through the hook's selector: this
    // is called from a mutation callback, not from render.
    const pushNotice = useNoticeStore((s) => s.push);
    const { data: session } = useSession();
    const me = session?.user?.email?.toLowerCase() ?? "you";
    const key = queueStateKey(cohortId);

    return useMutation({
        mutationFn: async (op: QueueOp): Promise<CohortQueueState> => {
            const res = await fetch("/api/queue-state", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ cohortId, ...op }),
            });
            if (!res.ok) throw await proxyFailure("/api/queue-state", res);
            return res.json();
        },
        onMutate: async (op) => {
            // Cancel in-flight refetches first, or a poll started before
            // this click can land after it and undo the optimistic edit.
            await qc.cancelQueries({ queryKey: key });
            const prev = qc.getQueryData<CohortQueueState>(key);
            qc.setQueryData<CohortQueueState>(key, (s) =>
                applyOp(s ?? emptyQueueState(), op, me, Date.now()),
            );
            return { prev };
        },
        onError: (err, op, ctx) => {
            // Restore the snapshot rather than refetching: a failed write
            // means the server never changed, and rolling back locally is
            // both instant and certain.
            if (ctx?.prev) qc.setQueryData(key, ctx.prev);
            // Then SAY so. The rollback alone made a snoozed row
            // reappear a moment later with no explanation, which reads
            // as the dashboard losing clicks. It matters most for
            // `contacted`, where the marker exists so a colleague does
            // not message the same participant.
            pushNotice(friendlyQueueOpError(op.op, err));
        },
        onSuccess: (serverState) => {
            qc.setQueryData(key, serverState);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: key });
        },
    });
}
