/**
 * What to do with a participant's `imageUrl`.
 *
 * The platform sends one of three things, and they need different
 * handling rather than a single `<img src>`:
 *
 *   null            no image chosen — fall back to initials
 *   a full URL      a stock avatar on the platform's own host, renderable
 *   a storage path  e.g. `images/hope/{userId}/my-img.png`, an object in
 *                   Azure blob storage that needs a signing request first
 *
 * Only the first two are handled today. The signing flow needs the
 * platform's reusable renderer, which has been promised but not shared,
 * and inventing a signing scheme against blob storage would mean writing
 * something that has to be thrown away.
 *
 * So the third case classifies as `needs-signing` and the caller shows
 * initials. That is the honest failure: a participant with an uploaded
 * photo looks the same as one who never set an image, rather than
 * rendering a broken picture or leaking an unsigned URL that 403s.
 *
 * Pure and dependency-free, so it unit-tests with no network — see
 * `vitest.config.mts`.
 */

export type ParticipantImage =
    /** No image, or nothing we can render yet. Show initials. */
    | { kind: "none" }
    /** Directly renderable. */
    | { kind: "absolute"; url: string }
    /** A blob-storage object; needs a signed URL before it can render. */
    | { kind: "needs-signing"; path: string };

/**
 * Hosts a participant image may be served from.
 *
 * An allow-list rather than "any https URL": `imageUrl` is data that
 * arrives over the wire, and rendering an arbitrary caller-supplied
 * origin makes the dashboard fetch from wherever that origin says. It
 * also leaks a request — complete with the viewing facilitator's IP and
 * referrer — to a third party the programme never chose.
 *
 * `HOPE_API_URL`'s own host is trusted automatically, since that is
 * where the stock avatars live.
 */
function allowedHosts(): string[] {
    const configured = process.env.HOPE_API_URL?.trim();
    if (!configured) return [];
    try {
        return [new URL(configured).host.toLowerCase()];
    } catch {
        return [];
    }
}

export function classifyParticipantImage(
    imageUrl: string | null | undefined,
    trustedHosts: string[] = allowedHosts(),
): ParticipantImage {
    const raw = (imageUrl ?? "").trim();
    if (!raw) return { kind: "none" };

    // Protocol-relative (`//host/path`) resolves to a remote origin just
    // as an absolute URL does, so treat it as one rather than letting it
    // fall through to the storage-path branch.
    const looksAbsolute = /^[a-z][a-z0-9+.-]*:/i.test(raw) || raw.startsWith("//");

    if (looksAbsolute) {
        let parsed: URL;
        try {
            parsed = new URL(raw.startsWith("//") ? `https:${raw}` : raw);
        } catch {
            return { kind: "none" };
        }
        // http: and https: only. A `javascript:` or `data:` value
        // reaching an <img> or an <a> is how this becomes an injection.
        if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
            return { kind: "none" };
        }
        if (!trustedHosts.includes(parsed.host.toLowerCase())) {
            return { kind: "none" };
        }
        return { kind: "absolute", url: parsed.toString() };
    }

    // Anything else is a relative storage path. Normalised so a caller
    // cannot climb out of the container with `../`.
    const path = raw.replace(/^\/+/, "");
    if (!path || path.split("/").includes("..")) return { kind: "none" };
    return { kind: "needs-signing", path };
}
