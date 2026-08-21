"use client";

import { useEffect } from "react";
import { CloudOff, X } from "lucide-react";

import { useNoticeStore, type Notice } from "@/lib/store/noticeStore";

/**
 * The one place the dashboard admits something didn't work.
 *
 * Bottom-centre and always mounted. `aria-live="polite"` rather than
 * "assertive": these are failures of a background write, not of the
 * facilitator's reading, and interrupting a screen-reader user
 * mid-sentence to say a snooze didn't save is louder than the news
 * deserves.
 *
 * Neutral styling, not the risk palette. Red here would compete with the
 * risk tiers, which are the only thing on this page that should mean
 * "high" — the same reasoning as the queue's load-error card.
 */

/** Long enough to read two sentences, short enough not to sit over the
 *  queue while somebody works. Dismiss is always available, and the
 *  detail is preserved in the console by the failing call itself. */
const AUTO_DISMISS_MS = 8_000;

export function NoticeBar() {
    const notices = useNoticeStore((s) => s.notices);
    if (notices.length === 0) return null;

    return (
        <div
            role="status"
            aria-live="polite"
            className="pointer-events-none fixed inset-x-0 bottom-4 z-50 flex flex-col items-center gap-2 px-4"
        >
            {notices.map((n) => (
                <NoticeCard key={n.id} notice={n} />
            ))}
        </div>
    );
}

function NoticeCard({ notice }: { notice: Notice }) {
    const dismiss = useNoticeStore((s) => s.dismiss);

    useEffect(() => {
        const t = setTimeout(() => dismiss(notice.id), AUTO_DISMISS_MS);
        return () => clearTimeout(t);
    }, [notice.id, dismiss]);

    return (
        // `pointer-events-auto` restores clicks the container gives up:
        // the wrapper spans the width of the page, and without this it
        // would swallow clicks on the queue underneath it.
        <div className="pointer-events-auto w-full max-w-md space-y-2 rounded-lg border border-border bg-surface px-3 py-3 text-xs shadow-lg">
            <div className="flex gap-2">
                <CloudOff
                    className="mt-0.5 h-4 w-4 shrink-0 text-muted"
                    aria-hidden
                />
                <div className="min-w-0 flex-1">
                    <p className="font-semibold text-text">{notice.title}</p>
                    <p className="mt-1 leading-relaxed text-text-2">
                        {notice.body}
                    </p>
                </div>
                <button
                    type="button"
                    onClick={() => dismiss(notice.id)}
                    aria-label="Dismiss"
                    className="-mr-1 -mt-1 shrink-0 rounded p-1 text-muted hover:bg-surface-2 hover:text-text"
                >
                    <X className="h-3.5 w-3.5" aria-hidden />
                </button>
            </div>
            {notice.detail ? (
                <details className="text-muted">
                    <summary className="cursor-pointer select-none hover:text-text-2">
                        Technical details
                    </summary>
                    <p className="mt-1 break-all font-mono text-[10px] leading-relaxed text-muted">
                        {notice.detail}
                    </p>
                </details>
            ) : null}
        </div>
    );
}
