"use client";

import {
    MutationCache,
    QueryCache,
    QueryClient,
    QueryClientProvider,
} from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { createContext, useContext, useState, type ReactNode } from "react";

import { ProxyError } from "@/lib/api/proxy-error";
import { exitPathForError } from "@/lib/session-redirect";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

/**
 * The platform's URL, resolved on the server (it derives from
 * `HOPE_API_URL`, which must not reach the browser as an env read) and
 * carried down so client components — the topbar, the login page, the
 * error boundary — can all offer the same way home.
 */
const HopeMoveUrlContext = createContext<string | null>(null);

export function useHopeMoveUrl(): string | null {
    return useContext(HopeMoveUrlContext);
}

/**
 * Send the browser back to the Facilitator Dashboard once, when the
 * session behind it has ended.
 *
 * A full navigation rather than a router push, deliberately: every
 * Zustand store, every cached query and every half-typed draft belongs
 * to a session that no longer exists, and a client-side transition would
 * carry all of it into the next one. The destination is usually another
 * origin anyway.
 *
 * The module-level latch is what keeps that from happening several times
 * over. A cohort page has the bundle, the batch, the queue-state poll
 * and per-participant predictions in flight at once; they fail together,
 * and without the latch each failure would fire its own navigation.
 */
let leaving = false;

function leaveIfSessionEnded(
    error: unknown,
    hopeMoveUrl: string | null,
): void {
    if (leaving || typeof window === "undefined") return;
    const path = exitPathForError(error, hopeMoveUrl);
    if (!path) return;
    leaving = true;
    window.location.assign(path);
}

export function Providers({
    children,
    hopeMoveUrl = null,
}: {
    children: ReactNode;
    hopeMoveUrl?: string | null;
}) {
    const [client] = useState(
        () =>
            new QueryClient({
                // Both caches, because a session can die between a
                // background poll and a facilitator clicking Snooze, and
                // whichever notices first should be the one that acts.
                queryCache: new QueryCache({
                    onError: (e) => leaveIfSessionEnded(e, hopeMoveUrl),
                }),
                mutationCache: new MutationCache({
                    onError: (e) => leaveIfSessionEnded(e, hopeMoveUrl),
                }),
                defaultOptions: {
                    queries: {
                        staleTime: FIVE_MIN_MS,
                        gcTime: ONE_DAY_MS,
                        refetchOnWindowFocus: false,
                        // Retrying a 401 cannot help: the session is
                        // gone, and each attempt only delays the
                        // redirect while the tab shows a failure the
                        // facilitator cannot act on.
                        retry: (count, error) =>
                            error instanceof ProxyError &&
                            error.status === 401
                                ? false
                                : count < 1,
                    },
                },
            }),
    );
    return (
        <HopeMoveUrlContext.Provider value={hopeMoveUrl}>
            <SessionProvider>
                <QueryClientProvider client={client}>
                    {children}
                </QueryClientProvider>
            </SessionProvider>
        </HopeMoveUrlContext.Provider>
    );
}
