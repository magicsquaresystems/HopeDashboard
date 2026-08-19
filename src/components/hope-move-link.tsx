import { ArrowLeft } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * The way back to the Hope Move platform.
 *
 * Facilitators arrive from Hope Move and think of it as home; every
 * page should offer the way back, and the target lives in ONE place so
 * a page can't quietly lose it. Renders nothing when
 * `NEXT_PUBLIC_HOPE_MOVE_URL` is unset (local dev, or a deployment not
 * yet configured) — a link to nowhere is worse than no link.
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
    const hopeMoveUrl = process.env.NEXT_PUBLIC_HOPE_MOVE_URL;
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
