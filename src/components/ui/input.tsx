import { forwardRef, type InputHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const Input = forwardRef<
    HTMLInputElement,
    InputHTMLAttributes<HTMLInputElement>
>(({ className, ...props }, ref) => (
    <input
        ref={ref}
        className={cn(
            "w-full rounded-md border border-border-2 bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent-2",
            className,
        )}
        {...props}
    />
));
Input.displayName = "Input";
