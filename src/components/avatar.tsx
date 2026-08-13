"use client";

import { cn } from "@/lib/utils";
import { seedHash } from "@/lib/demo-events";
import { useBundleDisplayName } from "@/lib/hooks/displayName";

const PALETTE = [
    "bg-rose-100 text-rose-700",
    "bg-amber-100 text-amber-700",
    "bg-emerald-100 text-emerald-700",
    "bg-sky-100 text-sky-700",
    "bg-violet-100 text-violet-700",
    "bg-fuchsia-100 text-fuchsia-700",
    "bg-cyan-100 text-cyan-700",
    "bg-orange-100 text-orange-700",
];

const SIZE = {
    sm: "h-8 w-8 text-xs",
    md: "h-10 w-10 text-sm",
    lg: "h-14 w-14 text-base",
} as const;

export type AvatarProps = {
    participantId: string;
    cohortId?: number;
    size?: keyof typeof SIZE;
    className?: string;
};

export function Avatar({
    participantId,
    cohortId,
    size = "md",
    className,
}: AvatarProps) {
    // Use the bundle's display name (e.g. "P26") for the initials, not
    // the raw user id digits. Before this, every avatar in cohort 1680
    // showed "P1" because the first two chars of "P100xxx" are always
    // P-then-1, which made the column visually undistinguishable.
    const initials = useBundleDisplayName(participantId, cohortId)
        .slice(0, 3)
        .toUpperCase();
    const color = PALETTE[seedHash(participantId) % PALETTE.length];
    return (
        <span
            aria-hidden
            className={cn(
                "inline-flex shrink-0 items-center justify-center rounded-full font-semibold",
                SIZE[size],
                color,
                className,
            )}
        >
            {initials}
        </span>
    );
}
