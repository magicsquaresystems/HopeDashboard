"use client";

import { useState } from "react";

import { cn } from "@/lib/utils";
import { seedHash } from "@/lib/demo-events";
import {
    useBundleDisplayName,
    useBundleImageUrl,
} from "@/lib/hooks/displayName";

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
    const src = useBundleImageUrl(participantId, cohortId);
    // The URL that failed, not a boolean. The detail panel swaps
    // participant without remounting this component, so a flag would
    // carry one person's broken image onto the next person's avatar and
    // hide a picture that loads perfectly well.
    const [failedSrc, setFailedSrc] = useState<string | null>(null);
    const color = PALETTE[seedHash(participantId) % PALETTE.length];

    if (src && src !== failedSrc) {
        return (
            // A plain <img>, not next/image. The host is the platform,
            // which differs between staging and production, so
            // next/image would need `remotePatterns` to name an origin
            // that is configuration rather than a constant — and these
            // are small static avatars that gain nothing from
            // optimisation. Falls back to initials on any error, which
            // covers a dead link, a private file and an offline
            // platform alike.
            // eslint-disable-next-line @next/next/no-img-element
            <img
                src={src}
                alt=""
                aria-hidden
                loading="lazy"
                decoding="async"
                onError={() => setFailedSrc(src)}
                className={cn(
                    "inline-block shrink-0 rounded-full object-cover",
                    SIZE[size],
                    // Shows through while the image loads and behind a
                    // transparent PNG, so a half-loaded column still
                    // reads as a column of avatars.
                    color,
                    className,
                )}
            />
        );
    }

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
