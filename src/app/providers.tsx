"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { createContext, useContext, useState, type ReactNode } from "react";

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
                defaultOptions: {
                    queries: {
                        staleTime: FIVE_MIN_MS,
                        gcTime: ONE_DAY_MS,
                        refetchOnWindowFocus: false,
                        retry: 1,
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
