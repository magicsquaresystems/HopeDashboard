/**
 * Short-lived read URLs for participant content in Azure Blob Storage.
 *
 * The platform sends `imageUrl` as a blob path — `imgs/hope/<guid>/…jpg`
 * — not something an `<img>` can load. Rendering it needs a signed URL,
 * and signing needs the storage account key.
 *
 * That key is the whole reason this file is server-only. It grants full
 * read AND write access to every participant's uploaded content, so it
 * must never reach a browser bundle, a log line, or an error message.
 * `import "server-only"` makes an accidental client import a build
 * failure rather than a silent leak.
 *
 * The signature is deliberately narrow: read permission, one named blob,
 * minutes of validity. A leaked URL from here exposes one image for a few
 * minutes; a leaked key exposes everything permanently.
 */

import "server-only";

import {
    BlobSASPermissions,
    SASProtocol,
    StorageSharedKeyCredential,
    generateBlobSASQueryParameters,
} from "@azure/storage-blob";

/**
 * How long a signed URL stays valid.
 *
 * Long enough that a slow page still renders its images, short enough
 * that a URL copied out of a network tab is useless by the time anyone
 * acts on it. The browser only needs it for the length of one request.
 */
const SAS_TTL_MS = 5 * 60_000;

/**
 * Clock skew allowance on the start time.
 *
 * Azure rejects a SAS whose start time is in its own future, and our
 * clock and theirs are not the same clock. Without this, a server running
 * a few seconds fast signs URLs that fail until it catches up.
 */
const CLOCK_SKEW_MS = 5 * 60_000;

export type BlobConfig = {
    accountName: string;
    accountKey: string;
    container: string;
};

/**
 * Read `AZURE_STORAGE_CONNECTION_STRING` and `AZURE_STORAGE_CONTAINER`.
 *
 * Returns null when either is missing, which is a supported state rather
 * than an error: a deployment without them simply shows initials instead
 * of photos, exactly as the dashboard did before this existed. Callers
 * decide how to say so.
 *
 * Parsed by hand rather than with `BlobServiceClient.fromConnectionString`
 * because that constructs a client — a network-capable object — where all
 * that is wanted is two strings. The format is documented and stable:
 * semicolon-separated `Key=Value` pairs.
 */
export function blobConfig(): BlobConfig | null {
    const raw = process.env.AZURE_STORAGE_CONNECTION_STRING?.trim();
    const container = process.env.AZURE_STORAGE_CONTAINER?.trim();
    if (!raw || !container) return null;

    const parts = new Map<string, string>();
    for (const segment of raw.split(";")) {
        const at = segment.indexOf("=");
        if (at <= 0) continue;
        // Only the FIRST "=" splits: an account key is base64 and ends
        // with padding "=" characters that must stay in the value.
        parts.set(
            segment.slice(0, at).trim().toLowerCase(),
            segment.slice(at + 1).trim(),
        );
    }
    const accountName = parts.get("accountname");
    const accountKey = parts.get("accountkey");
    if (!accountName || !accountKey) return null;
    return { accountName, accountKey, container };
}

/**
 * Normalise a platform-supplied blob path, or reject it.
 *
 * The path arrives from the platform and is passed to us by a browser,
 * so it is treated as untrusted input on both counts. Rejected:
 * anything absolute (already a URL — the caller should not be here),
 * anything containing a `..` segment or a backslash (both are attempts
 * to address a blob outside the intended prefix), and anything empty.
 *
 * Leading slashes are stripped rather than rejected: the platform is
 * inconsistent about them and it changes nothing about which blob is
 * named.
 */
export function normaliseBlobPath(raw: string | null | undefined): string | null {
    const value = (raw ?? "").trim();
    if (!value) return null;
    // A full URL, a protocol-relative URL, or a Windows-style path.
    if (/^[a-z][a-z0-9+.-]*:/i.test(value)) return null;
    if (value.startsWith("//") || value.includes("\\")) return null;

    const path = value.replace(/^\/+/, "");
    if (!path) return null;
    const segments = path.split("/");
    if (segments.some((s) => s === "." || s === ".." || s === "")) return null;
    return path;
}

/**
 * A time-limited, read-only URL for one blob.
 *
 * `https` only: a SAS token is a bearer credential for the blob, and
 * sending one over plain http would put it in the clear.
 */
export function signedBlobUrl(
    path: string,
    config: BlobConfig,
    now: number = Date.now(),
): string {
    const credential = new StorageSharedKeyCredential(
        config.accountName,
        config.accountKey,
    );
    const sas = generateBlobSASQueryParameters(
        {
            containerName: config.container,
            blobName: path,
            permissions: BlobSASPermissions.parse("r"),
            startsOn: new Date(now - CLOCK_SKEW_MS),
            expiresOn: new Date(now + SAS_TTL_MS),
            protocol: SASProtocol.Https,
        },
        credential,
    ).toString();

    const encoded = path
        .split("/")
        .map((segment) => encodeURIComponent(segment))
        .join("/");
    return (
        `https://${config.accountName}.blob.core.windows.net/` +
        `${config.container}/${encoded}?${sas}`
    );
}

/** Seconds a signed URL remains valid — for `Cache-Control` on the redirect. */
export const SAS_TTL_SECONDS = Math.floor(SAS_TTL_MS / 1000);
