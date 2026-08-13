"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { SessionProvider } from "next-auth/react";
import { useState, type ReactNode } from "react";

const ONE_DAY_MS = 24 * 60 * 60 * 1000;
const FIVE_MIN_MS = 5 * 60 * 1000;

export function Providers({ children }: { children: ReactNode }) {
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
        <SessionProvider>
            <QueryClientProvider client={client}>{children}</QueryClientProvider>
        </SessionProvider>
    );
}
