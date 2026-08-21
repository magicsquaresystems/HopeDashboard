/**
 * Where to send a browser whose session has stopped working.
 *
 * Pure, so the rule can be tested without a router or a live query
 * client — and so the decision is one readable function rather than a
 * condition buried in a cache callback.
 *
 * The case this exists for: the queue polls every 30 seconds, so a tab
 * left open when a facilitator's Hope link dies keeps asking and keeps
 * being refused. Before the API routes enforced the link, those requests
 * quietly succeeded for up to thirty days. Now they 401, and the tab
 * would otherwise fill with error cards nobody can act on.
 *
 * Only OUR OWN 401s redirect. A 401 from a backing service is a
 * misconfigured deployment, not an ended session, and throwing the
 * facilitator out to a login page would hide that from the person who
 * has to fix it.
 */

import { ProxyError } from "@/lib/api/proxy-error";

export function loginPathForError(error: unknown): string | null {
    if (!(error instanceof ProxyError) || error.status !== 401) return null;

    // The platform refused to renew the link, so the login page says so
    // and points back at the Facilitator Dashboard. Any other 401 is an
    // ordinary ended session and gets the page's default wording.
    return error.code === "hope_session_expired"
        ? "/login?error=session_expired"
        : "/login";
}
