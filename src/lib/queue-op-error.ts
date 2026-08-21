/**
 * Facilitator-facing translation of a failed queue write.
 *
 * Snooze, dismiss, bring-back and mark-as-contacted were all
 * fire-and-forget: `onError` rolled the optimistic edit back and said
 * nothing. The row reappeared a moment after it was snoozed and the only
 * account of why sat in the browser console. Worse for "contacted",
 * where the whole point is that a COLLEAGUE sees the marker — a silent
 * failure leaves two facilitators messaging the same participant, which
 * is the exact thing the shared state exists to prevent.
 *
 * Pure and dependency-free, so it unit-tests in the node environment.
 *
 * Bodies deliberately name no environment variable, route or status
 * code. A facilitator can act on "tell the programme team"; they cannot
 * act on `queue_state_not_configured`, and putting it in front of them
 * turns a small failure into an alarming one. The raw message travels
 * separately in `detail`, for whoever operates the deployment.
 */

import { ProxyError } from "@/lib/api/proxy-error";

export type QueueOpName =
    | "snooze"
    | "dismiss"
    | "undoSnooze"
    | "undoDismiss"
    | "contacted";

export type FriendlyQueueOpError = {
    title: string;
    body: string;
    /** Raw message, for a collapsed "Technical details" disclosure. */
    detail: string;
};

const TITLES: Record<QueueOpName, string> = {
    snooze: "Couldn't snooze this participant",
    dismiss: "Couldn't dismiss this participant",
    undoSnooze: "Couldn't bring this participant back",
    undoDismiss: "Couldn't bring this participant back",
    contacted: "Couldn't mark this participant as contacted",
};

function bodyFor(op: QueueOpName, error: unknown): string {
    const code = error instanceof ProxyError ? error.code : undefined;
    const status = error instanceof ProxyError ? error.status : undefined;

    if (code === "queue_state_not_configured") {
        // Not retryable by the facilitator: the deployment has no shared
        // store, so this will fail identically until someone changes its
        // configuration.
        return "Shared markers aren't set up on this deployment, so the change wasn't saved. Tell the programme team.";
    }
    if (code === "queue_state_quota") {
        return "Shared markers are paused for today because their storage limit was reached. Tell the programme team.";
    }
    if (status === 401) {
        return "Your session with Hope has ended, so the change wasn't saved. Open the Insights Hub again from your Facilitator Dashboard.";
    }
    if (status === 403) {
        return "You're not assigned to this cohort any more, so the change wasn't saved.";
    }
    return "The change wasn't saved. Check your connection and try again.";
}

export function friendlyQueueOpError(
    op: QueueOpName,
    error: unknown,
): FriendlyQueueOpError {
    let body = bodyFor(op, error);

    // The copy flow puts the reply on the clipboard BEFORE recording the
    // contact, so a failed marker does not mean a lost draft. Saying so
    // stops a facilitator re-generating a reply they are still holding.
    if (op === "contacted") {
        body += " Your copied reply is still on the clipboard.";
    }

    return {
        title: TITLES[op],
        body,
        detail:
            error instanceof Error
                ? error.message
                : String(error ?? "unknown error"),
    };
}

/**
 * Whether re-asking could ever succeed.
 *
 * The queue-state GET polls every 30 seconds. A network blip is worth
 * polling through; a missing store or a lost session is not — those fail
 * identically forever, and the retries only bury the reason under more
 * failures.
 */
export function isQueueStateFatal(error: unknown): boolean {
    if (!(error instanceof ProxyError)) return false;
    return (
        error.status === 401 ||
        error.status === 403 ||
        error.code === "queue_state_not_configured" ||
        error.code === "queue_state_quota"
    );
}
