import { describe, expect, it } from "vitest";

import { ProxyError, proxyFailure } from "./proxy-error";

function res(body: string, status = 500, statusText = ""): Response {
    return new Response(body, { status, statusText });
}

describe("proxyFailure", () => {
    it("lifts detail and code out of the proxy's JSON body", async () => {
        const err = await proxyFailure(
            "/api/queue-state",
            res(
                JSON.stringify({
                    detail: "Snoozing is not available on this deployment.",
                    code: "queue_state_not_configured",
                }),
                503,
            ),
        );
        expect(err).toBeInstanceOf(ProxyError);
        expect(err.status).toBe(503);
        expect(err.code).toBe("queue_state_not_configured");
        expect(err.detail).toBe("Snoozing is not available on this deployment.");
    });

    it("keeps the message format its readers substring-match on", async () => {
        // `classifyGenerateError` and `friendlyLoadError` parse this string.
        const err = await proxyFailure("/api/proxy/generate", res("{}", 502));
        expect(err.message).toMatch(/^\/api\/proxy\/generate failed: 502 /);
    });

    it("falls back to the raw body when it is not JSON", async () => {
        // A gateway's HTML error page, say.
        const err = await proxyFailure("/api/x", res("<html>nope</html>", 504));
        expect(err.detail).toBe("<html>nope</html>");
        expect(err.code).toBeUndefined();
    });

    it("falls back to statusText on an empty body", async () => {
        const err = await proxyFailure("/api/x", res("", 500, "Server Error"));
        expect(err.detail).toBe("Server Error");
    });

    it("ignores a blank detail or code rather than reporting an empty one", async () => {
        const err = await proxyFailure(
            "/api/x",
            res(JSON.stringify({ detail: "   ", code: "" }), 400),
        );
        expect(err.detail).toBe(JSON.stringify({ detail: "   ", code: "" }));
        expect(err.code).toBeUndefined();
    });
});
