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

function queueStateKey(cohortId: number) {
    return ["queue-state", cohortId] as const;
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
        // Stop polling once the failure is one that cannot fix itself.
        // A missing store or an ended session fails identically every 30
        // seconds forever; continuing to ask buries the reason under
        // more failures and keeps a dead deployment looking busy.
        refetchInterval: (query) =>
            isQueueStateFatal(query.state.error) ? false : POLL_MS,
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
