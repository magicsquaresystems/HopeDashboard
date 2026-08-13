import { forwardRef, type SelectHTMLAttributes } from "react";

import { cn } from "@/lib/utils";

export const Select = forwardRef<
    HTMLSelectElement,
    SelectHTMLAttributes<HTMLSelectElement>
>(({ className, children, ...props }, ref) => (
    <select
        ref={ref}
        className={cn(
            "h-9 w-full rounded-md border border-slate-300 bg-white px-3 text-sm focus:outline-none focus:border-slate-500 focus:ring-1 focus:ring-slate-300",
            className,
        )}
        {...props}
    >
        {children}
    </select>
));
Select.displayName = "Select";
