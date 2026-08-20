"use client";

import { useCallback, useEffect, useRef, useState } from "react";

/**
 * Clipboard copy with an honest result.
 *
 * The caller decides what a successful copy MEANS — in the drafts panel
 * it is the moment a reply counts as "contacted", so `copy` must never
 * pretend: it resolves `true` only when the text is actually on the
 * clipboard. The async Clipboard API needs a secure context and can be
 * denied by permissions policy; the `execCommand` path covers older
 * embeds. When both fail the caller selects the text and asks the
 * facilitator to press Ctrl+C — worse ergonomics, same honesty.
 *
 * `copied` auto-clears after `resetMs` so a "Copied" button label
 * reverts on its own; `failed` clears on the next attempt.
 */
export function useCopyToClipboard(resetMs = 2500) {
    const [copied, setCopied] = useState(false);
    const [failed, setFailed] = useState(false);
    const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

    useEffect(() => {
        return () => {
            if (timer.current) clearTimeout(timer.current);
        };
    }, []);

    const copy = useCallback(
        async (text: string): Promise<boolean> => {
            setFailed(false);
            let ok = false;
            try {
                if (navigator.clipboard?.writeText) {
                    await navigator.clipboard.writeText(text);
                    ok = true;
                }
            } catch {
                /* fall through to execCommand */
            }
            if (!ok) {
                const scratch = document.createElement("textarea");
                try {
                    scratch.value = text;
                    // Off-screen, not display:none — a hidden element
                    // cannot be selected, and selection is what
                    // execCommand copies.
                    scratch.style.position = "fixed";
                    scratch.style.left = "-9999px";
                    scratch.setAttribute("readonly", "");
                    document.body.appendChild(scratch);
                    scratch.select();
                    ok = document.execCommand("copy");
                } catch {
                    ok = false;
                } finally {
                    // In a context where execCommand throws (sandboxed
                    // iframe, permissions policy) the removal used to be
                    // skipped, leaving one orphaned textarea on the body
                    // per failed attempt.
                    scratch.remove();
                }
            }
            setCopied(ok);
            setFailed(!ok);
            if (ok) {
                if (timer.current) clearTimeout(timer.current);
                timer.current = setTimeout(() => setCopied(false), resetMs);
            }
            return ok;
        },
        [resetMs],
    );

    return { copied, failed, copy };
}
