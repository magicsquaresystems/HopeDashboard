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
    /**
     * What KIND of failure this is, so the UI can offer the right way
     * out. A dead session and a flaky network both used to render a
     * "Try again" button, but retrying an expired session cannot
     * succeed — it just fails again with the same message, which reads
     * as the dashboard being broken. `session` gets a link back to Hope
     * instead.
     */
    kind: "session" | "access" | "outage";
};

export function friendlyLoadError(message: string): FriendlyLoadError {
    const m = message.toLowerCase();

    // Checked before the generic 401 branch: both are 401s, but this one
    // knows the platform itself refused to renew the link, so refreshing
    // the page is not among the things that will help.
    if (m.includes("hope_session_expired")) {
        return {
            title: "Your session with Hope has ended",
            body: "Open the Insights Hub again from your Facilitator Dashboard on Hope to carry on.",
            detail: message,
            kind: "session",
        };
    }

    if (
        m.includes("401") ||
        m.includes("unauthorized") ||
        m.includes("not signed in") ||
        m.includes("auth_required")
    ) {
        return {
            title: "Your session has ended",
            body: "Refresh the page, or open the Insights Hub again from your Facilitator Dashboard on Hope.",
            detail: message,
            kind: "session",
        };
    }

    if (m.includes("403") || m.includes("forbidden")) {
        return {
            title: "This cohort isn't available to you",
            body: "You're not assigned to this cohort any more. If that seems wrong, ask the programme admin.",
            detail: message,
            kind: "access",
        };
    }

    return {
        title: "Risk scores aren't available right now",
        body: "We couldn't load the follow-up list. Try again in a minute. If it keeps happening, tell the programme team.",
        detail: message,
        kind: "outage",
    };
}
