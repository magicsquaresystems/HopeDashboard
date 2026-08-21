/**
 * A failed call to one of this app's own `/api/proxy/*` routes, with the
 * status and error code kept rather than flattened into a sentence.
 *
 * Those routes answer `{ detail, code }` through `withApiErrors`, and
 * every caller used to build a string from it and throw a bare `Error`.
 * That worked for display, because the consumers substring-match, but it
 * threw away the two fields anything else needs: a 401 has to be told
 * apart from a 403 to know whether to offer a retry or a way back to
 * Hope, and a `queue_state_not_configured` from a network blip to know
 * whether polling can ever succeed.
 *
 * The message keeps the exact format it had — `"<path> failed: <status>
 * <detail>"` — because `classifyGenerateError` and `friendlyLoadError`
 * read it, and this change is meant to add a channel, not disturb one.
 *
 * Pure: no React, no Next, so it unit-tests in the node environment.
 */
export class ProxyError extends Error {
    constructor(
        readonly path: string,
        readonly status: number,
        readonly detail: string,
        readonly code?: string,
    ) {
        super(`${path} failed: ${status} ${detail}`);
        this.name = "ProxyError";
    }
}

/**
 * Build a `ProxyError` from a failed response.
 *
 * Reads the body exactly once — a `Response` body cannot be consumed
 * twice, and an earlier version of this logic that tried lost the detail
 * on the second read. Falls back through raw text to `statusText`, which
 * is the empty string over HTTP/2 and therefore never trusted alone.
 */
export async function proxyFailure(
    path: string,
    res: Response,
): Promise<ProxyError> {
    const raw = await res.text().catch(() => "");
    let detail = raw || res.statusText;
    let code: string | undefined;

    if (raw) {
        try {
            const parsed = JSON.parse(raw) as {
                detail?: unknown;
                code?: unknown;
            };
            if (typeof parsed.detail === "string" && parsed.detail.trim()) {
                detail = parsed.detail;
            }
            if (typeof parsed.code === "string" && parsed.code.trim()) {
                code = parsed.code;
            }
        } catch {
            /* not JSON — a gateway's HTML page, say. Keep the raw text. */
        }
    }

    return new ProxyError(path, res.status, detail, code);
}
