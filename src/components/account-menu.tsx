"use client";

import { useEffect, useRef, useState } from "react";
import { signOut } from "next-auth/react";
import { ChevronDown, ExternalLink, LogOut } from "lucide-react";

import { useHopeMoveUrl } from "@/app/providers";

/**
 * Identity and the ways out, as one menu.
 *
 * Modelled on the Hope Move platform's own header, which facilitators
 * already know: an avatar opens a dropdown, and LOGOUT sits at the
 * bottom of it. Two things follow from copying that rather than
 * inventing our own.
 *
 * Sign-out stops being a permanent button in the bar. It ends a session
 * mid-draft, and a naked icon beside the account name is one stray
 * click away from doing exactly that; behind a menu it takes intent.
 *
 * And the way back to the platform stops competing with it. Both are
 * "leave this screen" actions, so they belong in the same place, with
 * the destructive one last and separated. The cohort picker still
 * carries a prominent back link, since that page is the front door.
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
                // component does not implement, and one that would have
                // made sign-out unreachable for a screen-reader user now
                // that the menu is the only route to it. As ordinary
                // links and buttons, Tab reaches everything.
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

                    <div className="border-t border-border">
                        <button
                            type="button"
                            onClick={() => signOut({ callbackUrl: "/login" })}
                            className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-text-2 transition-colors hover:bg-surface-2 hover:text-text"
                        >
                            <LogOut
                                className="h-3.5 w-3.5 text-muted"
                                aria-hidden
                            />
                            Sign out
                        </button>
                    </div>
                </div>
            )}
        </div>
    );
}
