"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown, ExternalLink } from "lucide-react";

import { useHopeMoveUrl } from "@/app/providers";

/**
 * Identity and the way back, as one menu.
 *
 * Modelled on the Hope Move platform's own header, which facilitators
 * already know: an avatar opens a dropdown holding who you are and where
 * you can go.
 *
 * There is deliberately NO sign-out. Nobody signs IN here — a
 * facilitator arrives from the Facilitator Dashboard on Hope, already
 * authenticated, and the only place they go afterwards is back to it. A
 * sign-out offered them a state they could not undo from this side: no
 * login form exists to return through, so the only recovery was to find
 * their way back to Hope and start again, which is precisely what "Back
 * to Facilitator Dashboard" does without ending anything.
 *
 * It is also no longer the mechanism that ends a session. API routes now
 * refuse a session whose platform link has died (`session-gate.ts`), and
 * the query client sends the tab back to the login page when they do, so
 * a session outlives its platform link by about one poll interval rather
 * than by the thirty days the cookie allows.
 */
export function AccountMenu({
    name,
    email,
}: {
    name: string;
    email?: string | null;
}) {
    const [open, setOpen] = useState(false);
    const wrapRef = useRef<HTMLDivElement>(null);
    const triggerRef = useRef<HTMLButtonElement>(null);
    const hopeMoveUrl = useHopeMoveUrl();

    // Close on outside click and on Escape. Without both, a menu opened
    // by accident stays over the queue until something else is clicked.
    useEffect(() => {
        if (!open) return;
        const onPointer = (e: PointerEvent) => {
            if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
        };
        const onKey = (e: KeyboardEvent) => {
            if (e.key !== "Escape") return;
            setOpen(false);
            // Focus would otherwise fall to <body> when the panel
            // unmounts, stranding a keyboard user at the top of the
            // document.
            triggerRef.current?.focus();
        };
        document.addEventListener("pointerdown", onPointer);
        document.addEventListener("keydown", onKey);
        return () => {
            document.removeEventListener("pointerdown", onPointer);
            document.removeEventListener("keydown", onKey);
        };
    }, [open]);

    const initials =
        name
            .split(/\s+/)
            .map((p) => p[0])
            .filter(Boolean)
            .slice(0, 2)
            .join("")
            .toUpperCase() || "?";

    return (
        <div ref={wrapRef} className="relative">
            <button
                ref={triggerRef}
                type="button"
                onClick={() => setOpen((v) => !v)}
                aria-expanded={open}
                aria-controls="account-panel"
                className="flex items-center gap-2 rounded-md border border-border bg-surface py-1 pl-1 pr-2 transition-colors hover:bg-surface-2"
            >
                <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-accent-2 text-[10px] font-semibold text-accent-ink">
                    {initials}
                </span>
                <span className="max-w-[14ch] truncate text-xs text-text-2">
                    {name}
                </span>
                <ChevronDown
                    className={
                        "h-3.5 w-3.5 shrink-0 text-muted transition-transform " +
                        (open ? "rotate-180" : "")
                    }
                    aria-hidden
                />
            </button>

            {open && (
                // A plain panel, not `role="menu"`. That role puts
                // assistive tech into application mode, where arrow keys
                // rather than Tab move between items — a contract this
                // component does not implement, and one that would make
                // the link unreachable for a screen-reader user. As an
                // ordinary link, Tab reaches it.
                <div
                    id="account-panel"
                    aria-label={`Account: ${name}`}
                    className="absolute right-0 z-50 mt-1.5 w-60 overflow-hidden rounded-lg border border-border bg-surface shadow-lg"
                >
                    <div className="border-b border-border px-3 py-2.5">
                        <p className="text-xs font-semibold text-text">
                            {name}
                        </p>
                        {/* Skipped when the display name already IS the
                            email, which happens for accounts with no
                            name set — printing it twice looks broken. */}
                        {email && email !== name && (
                            <p className="mt-0.5 truncate text-[11px] text-muted">
                                {email}
                            </p>
                        )}
                    </div>

                    {hopeMoveUrl && (
                        <a
                            href={hopeMoveUrl}
                            className="flex items-center gap-2 px-3 py-2.5 text-xs text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
                        >
                            <ExternalLink
                                className="h-3.5 w-3.5 text-muted"
                                aria-hidden
                            />
                            Back to Facilitator Dashboard
                        </a>
                    )}
                </div>
            )}
        </div>
    );
}
