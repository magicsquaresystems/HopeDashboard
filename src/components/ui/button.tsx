import { cva, type VariantProps } from "class-variance-authority";
import { Loader2 } from "lucide-react";
import { forwardRef, type ButtonHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

const buttonVariants = cva(
    "inline-flex items-center justify-center gap-2 rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-400 disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                primary: "bg-slate-900 text-white hover:bg-slate-800",
                secondary:
                    "bg-white text-slate-900 border border-slate-200 hover:bg-slate-100",
                ghost: "text-slate-700 hover:bg-slate-100",
                danger: "bg-rose-600 text-white hover:bg-rose-700",
            },
            size: {
                sm: "h-8 px-3",
                md: "h-9 px-4",
                lg: "h-10 px-5",
                icon: "h-8 w-8 p-0",
            },
        },
        defaultVariants: { variant: "primary", size: "md" },
    },
);

export type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> &
    VariantProps<typeof buttonVariants> & {
        /**
         * In-flight state. Renders a spinner, blocks further clicks, and marks
         * the button `aria-busy` so screen readers announce the wait. Prefer
         * this over hand-rolling a `<Loader2 className="animate-spin">` in the
         * children — every async action in the app should look the same.
         */
        loading?: boolean;
        /**
         * Label to swap in while `loading`. Omit to keep the resting label —
         * the spinner alone carries the state. Ignored at `size="icon"`, where
         * the spinner replaces the icon outright.
         */
        loadingText?: string;
    };

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
    (
        {
            className,
            variant,
            size,
            loading = false,
            loadingText,
            disabled,
            children,
            ...props
        },
        ref,
    ) => {
        // Icon buttons have no room for spinner + icon side by side, so the
        // spinner stands in for the icon rather than joining it.
        const iconOnly = size === "icon";
        return (
            <button
                ref={ref}
                className={cn(buttonVariants({ variant, size }), className)}
                disabled={disabled || loading}
                aria-busy={loading || undefined}
                {...props}
            >
                {loading && (
                    <Loader2
                        className={cn(
                            "shrink-0 animate-spin",
                            iconOnly ? "h-3.5 w-3.5" : "h-4 w-4",
                        )}
                        aria-hidden
                    />
                )}
                {loading && iconOnly
                    ? null
                    : loading && loadingText
                      ? loadingText
                      : children}
            </button>
        );
    },
);
Button.displayName = "Button";
