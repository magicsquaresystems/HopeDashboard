/**
 * Where an `<img>` should point for a platform-supplied image value.
 *
 * The platform sends two different things in the same field. A participant
 * who picked an avatar from the Hope library gets an absolute URL; one who
 * uploaded a photo gets an Azure blob path (`imgs/hope/<guid>/…jpg`). The
 * blob path is not loadable on its own — it needs a signed URL, and signing
 * needs a key that must never reach a browser.
 *
 * So blob paths route through `/api/proxy/blob`, which signs server-side
 * and redirects. Absolute URLs are returned unchanged; there is nothing to
 * sign and proxying them would add a hop for no reason.
 *
 * Client-safe on purpose — this is imported by the avatar, which is a
 * client component. It holds no secret and makes no decision that matters
 * for security: the proxy route re-validates every path it is given, since
 * anything reaching it came through a browser.
 */

/** Values that are already loadable: `https://…`, and protocol-relative. */
function isAbsolute(value: string): boolean {
    return /^https?:\/\//i.test(value) || value.startsWith("//");
}

/**
 * Returns a URL for `<img src>`, or null when there is nothing to show.
 *
 * Null rather than a placeholder path: the callers already render initials
 * when they have no image, and a broken `<img>` is worse than no `<img>`.
 */
export function imageSrc(value: string | null | undefined): string | null {
    const raw = (value ?? "").trim();
    if (!raw) return null;
    if (isAbsolute(raw)) return raw;
    // Anything else is treated as a blob path. `encodeURIComponent` on the
    // whole value keeps the slashes inside one query parameter rather than
    // letting them reshape the URL.
    return `/api/proxy/blob?path=${encodeURIComponent(raw.replace(/^\/+/, ""))}`;
}
