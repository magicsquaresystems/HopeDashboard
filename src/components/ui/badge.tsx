import { cva, type VariantProps } from "class-variance-authority";
import { type HTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
    "inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium",
    {
        variants: {
            variant: {
                neutral: "bg-surface-2 text-text-2 ring-1 ring-border",
                low: "bg-risk-lo-bg text-risk-lo ring-1 ring-border",
                medium: "bg-risk-md-bg text-risk-md ring-1 ring-border",
                high: "bg-risk-hi-bg text-risk-hi ring-1 ring-border",
                info: "bg-accent-2 text-accent-ink ring-1 ring-border",
            },
        },
        defaultVariants: { variant: "neutral" },
    },
);

export type BadgeProps = HTMLAttributes<HTMLSpanElement> &
    VariantProps<typeof badgeVariants>;

export function Badge({ className, variant, ...props }: BadgeProps) {
    return (
        <span
            className={cn(badgeVariants({ variant }), className)}
            {...props}
        />
    );
}
