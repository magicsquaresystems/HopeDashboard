import { describe, expect, it } from "vitest";

import { ApiError, upstreamError } from "./client";

function res(body: string, status = 400, statusText = "Bad Request"): Response {
    return new Response(body, { status, statusText });
}

/**
 * The first real reply sent to Hope came back as "400 Bad Request" and
 * nothing else, because this only understood our own services' error
 * shape. The platform's reason — the one sentence that said what was
 * wrong — was dropped one hop from the screen. These pin every shape an
 * upstream has been seen to use, so a refusal always arrives with its
 * reason attached.
 */
describe("upstreamError", () => {
    it("reads our own services' { detail, code }", async () => {
        const err = await upstreamError(
            res(
                JSON.stringify({ detail: "signature missing", code: "invalid_signature" }),
                401,
            ),
        );
        expect(err).toBeInstanceOf(ApiError);
        expect(err.status).toBe(401);
        expect(err.detail).toBe("signature missing");
        expect(err.code).toBe("invalid_signature");
    });

    it("reads the Hope platform's ApiError shape in either casing", async () => {
        for (const body of [
            {
                code: "ActivityTypeInvalid",
                message: "The activity type must be one of Goal, Gratitude.",
            },
            {
                Code: "ActivityTypeInvalid",
                Message: "The activity type must be one of Goal, Gratitude.",
            },
        ]) {
            const err = await upstreamError(res(JSON.stringify(body)));
            expect(err.code).toBe("ActivityTypeInvalid");
            expect(err.detail).toBe("The activity type must be one of Goal, Gratitude.");
        }
    });

    it("reads ASP.NET's HttpError and keeps the detail sentence", async () => {
        const err = await upstreamError(
            res(
                JSON.stringify({
                    Message: "The request is invalid.",
                    MessageDetail:
                        "The parameters dictionary contains a null entry for parameter 'recordId'.",
                }),
            ),
        );
        expect(err.detail).toBe(
            "The request is invalid. The parameters dictionary contains a null entry for parameter 'recordId'.",
        );
        expect(err.code).toBeUndefined();
    });

    it("reads RFC 7807 problem details", async () => {
        const err = await upstreamError(
            res(JSON.stringify({ title: "One or more validation errors occurred.", status: 400 })),
        );
        expect(err.detail).toBe("One or more validation errors occurred.");
    });

    it("keeps a non-JSON body rather than the status text", async () => {
        const err = await upstreamError(res("<html>Request blocked</html>", 403, "Forbidden"));
        expect(err.detail).toBe("<html>Request blocked</html>");
    });

    it("falls back to the status text on an empty body", async () => {
        const err = await upstreamError(res("", 502, "Bad Gateway"));
        expect(err.detail).toBe("Bad Gateway");
    });

    it("truncates a runaway body", async () => {
        const err = await upstreamError(res("x".repeat(5000), 500, "Internal Server Error"));
        expect(err.detail.length).toBeLessThanOrEqual(401);
        expect(err.detail.endsWith("…")).toBe(true);
    });
});
