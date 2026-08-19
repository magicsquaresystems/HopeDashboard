/**
 * Facilitator-facing translation of a failed load.
 *
 * Errors that reach the queue arrive as strings like
 * `/api/proxy/dropout/batch failed: 503 This deployment is missing …` —
 * useful to whoever operates the deployment, alarming noise to a
 * facilitator mid-session. This maps them onto a calm title/body pair
 * and keeps the raw text in `detail` for a collapsed disclosure, so the
 * person who CAN act on it still finds it.
 *
 * Pure and dependency-free so it unit-tests in the Node Vitest setup.
 */

export type FriendlyLoadError = {
    title: string;
    body: string;
    /** The raw message, for a collapsed "Technical details" disclosure. */
    detail: string;
};

export function friendlyLoadError(message: string): FriendlyLoadError {
    const m = message.toLowerCase();

    if (
        m.includes("401") ||
        m.includes("unauthorized") ||
        m.includes("not signed in") ||
        m.includes("auth_required")
    ) {
        return {
            title: "Your session has ended",
            body: "Refresh the page, or open the Insights Hub again from your Hope Move dashboard.",
            detail: message,
        };
    }

    if (m.includes("403") || m.includes("forbidden")) {
        return {
            title: "This cohort isn't available to you",
            body: "You're not assigned to this cohort any more. If that seems wrong, ask the programme admin.",
            detail: message,
        };
    }

    return {
        title: "Risk scores aren't available right now",
        body: "We couldn't load the follow-up list. Try again in a minute. If it keeps happening, tell the programme team.",
        detail: message,
    };
}
