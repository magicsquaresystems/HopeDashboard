/**
 * Where to send a browser whose session has stopped working.
 *
 * Straight back to the Facilitator Dashboard on Hope, whenever we know
 * its URL. That is the dashboard the facilitator came from, they are
 * still signed in to it, and the Insights Hub tile there mints a fresh
 * session in one click. Sending them to our own `/login` instead put an
 * explainer in the way of an action they had to take anyway — and this
 * app has no sign-in form for that page to offer, so it could only ever
 * say "go back to Hope" in words.
 *
 * `/login` remains the fallback for a deployment with no platform URL
 * configured, where there is genuinely nowhere else to send them.
 *
 * Pure, so the rule is testable without a router or a query client.
 *
 * The case this exists for: the queue polls every 30 seconds, so a tab
 * left open when a facilitator's Hope link dies keeps asking and keeps
 * being refused. Before the API routes enforced the link those requests
 * quietly succeeded for up to thirty days; now they 401, and without
 * this the tab would fill with error cards nobody can act on.
 *
 * Only OUR OWN 401s redirect. A 401 from a backing service is a
 * misconfigured deployment, not an ended session, and ejecting the
 * facilitator would hide that from the person who has to fix it.
 */

import { ProxyError } from "@/lib/api/proxy-error";

export function exitPathForError(
    error: unknown,
    hopeMoveUrl: string | null,
): string | null {
    if (!(error instanceof ProxyError) || error.status !== 401) return null;
    return exitPath(hopeMoveUrl, error.code === "hope_session_expired");
}

/**
 * The same destination, for the server components that reach this
 * conclusion without an error object — a page render that finds the
 * session already dead.
 */
export function exitPath(
    hopeMoveUrl: string | null,
    expired: boolean,
): string {
    if (hopeMoveUrl) return hopeMoveUrl;
    // No platform URL configured: the login page at least explains what
    // happened. `session_expired` has its own wording; anything else
    // gets the page's default.
    return expired ? "/login?error=session_expired" : "/login";
}
