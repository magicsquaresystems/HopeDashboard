"use client";

import { ArrowLeft } from "lucide-react";

import { useHopeMoveUrl } from "@/app/providers";
import { cn } from "@/lib/utils";

/**
 * The way back to the Hope Move platform.
 *
 * Facilitators arrive from Hope Move and think of it as home, so every
 * page should offer the way back and the target should live in ONE
 * place. The URL is resolved server-side (see lib/hope-move-url.ts) and
 * read from context here, which is what lets the same component work in
 * the topbar, on the cohort picker, and on the signed-out page alike.
 *
 * Renders nothing when no platform URL can be resolved at all — a link
 * to nowhere is worse than no link.
 *
 * `quiet` is the in-workspace variant, small and out of the way so it
 * orients without inviting a mid-draft exit. `prominent` is for pages
 * whose whole job is routing the facilitator somewhere (login, errors).
 */
export function HopeMoveLink({
    variant = "quiet",
    label = "Back to Hope Move",
    className,
}: {
    variant?: "quiet" | "prominent";
    label?: string;
    className?: string;
}) {
    const hopeMoveUrl = useHopeMoveUrl();
    if (!hopeMoveUrl) return null;

    if (variant === "prominent") {
        return (
            <a
                href={hopeMoveUrl}
                className={cn(
                    "block w-full rounded-md bg-text px-4 py-2 text-center text-sm font-medium text-surface",
                    className,
                )}
            >
                {label}
            </a>
        );
    }

    return (
        <a
            href={hopeMoveUrl}
            className={cn(
                "inline-flex items-center gap-1.5 text-sm text-muted transition-colors hover:text-text",
                className,
            )}
        >
            <ArrowLeft className="h-4 w-4" aria-hidden />
            {label}
        </a>
    );
}
