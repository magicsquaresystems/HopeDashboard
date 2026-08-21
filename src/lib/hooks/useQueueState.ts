"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useSession } from "next-auth/react";

import { proxyFailure } from "@/lib/api/proxy-error";
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
        refetchInterval: POLL_MS,
    });
}

export function useQueueOp(cohortId: number) {
    const qc = useQueryClient();
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
        onError: (_err, _op, ctx) => {
            // Restore the snapshot rather than refetching: a failed write
            // means the server never changed, and rolling back locally is
            // both instant and certain.
            if (ctx?.prev) qc.setQueryData(key, ctx.prev);
        },
        onSuccess: (serverState) => {
            qc.setQueryData(key, serverState);
        },
        onSettled: () => {
            qc.invalidateQueries({ queryKey: key });
        },
    });
}
