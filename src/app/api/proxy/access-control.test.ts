import { beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";
import { ApiError } from "@/lib/api/client";
import type { CohortBundle } from "@/lib/server/cohort-data";

const mocks = vi.hoisted(() => ({
    email: vi.fn(), access: vi.fn(), bundle: vi.fn(), generate: vi.fn(),
    config: vi.fn(), sign: vi.fn(),
}));
vi.mock("@/lib/auth/facilitator", () => ({ requireFacilitatorEmail: mocks.email }));
vi.mock("@/lib/server/assignments", () => ({ assertCohortAccess: mocks.access }));
vi.mock("@/lib/server/cohort-data", () => ({ resolveCohortBundle: mocks.bundle }));
vi.mock("@/lib/api/server", () => ({ commentGen: () => ({ generate: mocks.generate }) }));
vi.mock("@/lib/server/blob-url", async (original) => ({
    ...await original<typeof import("@/lib/server/blob-url")>(),
    blobConfig: mocks.config, signedBlobUrl: mocks.sign,
}));

import { POST } from "./generate/route";
import { GET } from "./blob/route";
import { bundleToHistory } from "@/lib/realCohort";
import { imageSrc } from "@/lib/image-src";

function bundle(): CohortBundle {
    return {
        cohort: { id: 123, code: "TEST", moduleId: 1, moduleName: "HOPE",
            effectiveStart: "2026-01-01", programmeLengthDays: 42 },
        participants: [{ participant_id: "7", displayName: "Test", bio: "",
            interview: [], imageUrl: "imgs/hope/a/profile.png", firstName: null,
            startedAt: "2026-01-01", finishedAt: null, priorFacilitatorReplies: [],
            activityCount: 1, wellbeing: [],
            events: [{ timestamp: "2026-01-02", event_type: "activity",
                image_url: "/imgs/hope/a/post.jpg" }] }],
    };
}
const payload = { cohort_id: 123, participant_id: 7, post_text: "A synthetic goal" };
function generateRequest(body: unknown = payload) {
    return new NextRequest("https://dashboard.example/api/proxy/generate", {
        method: "POST", body: JSON.stringify(body),
        headers: { "Content-Type": "application/json" },
    });
}
function imageRequest(path = "imgs/hope/a/profile.png", cohort = "123") {
    const params = new URLSearchParams({ path, cohortId: cohort });
    return new NextRequest(`https://dashboard.example/api/proxy/blob?${params}`);
}
beforeEach(() => {
    vi.resetAllMocks();
    mocks.email.mockResolvedValue("facilitator@example.org");
    mocks.access.mockResolvedValue(undefined);
    mocks.bundle.mockResolvedValue(bundle());
    mocks.generate.mockResolvedValue({ drafts: [] });
    mocks.config.mockReturnValue({ accountName: "test", accountKey: "test", container: "test" });
    mocks.sign.mockReturnValue("https://storage.example/test?signature=test");
});

describe("generation access", () => {
    it("forwards only after checking the cohort and participant", async () => {
        expect((await POST(generateRequest())).status).toBe(200);
        expect(mocks.access).toHaveBeenCalledWith("facilitator@example.org", 123);
        expect(mocks.bundle).toHaveBeenCalledWith(123);
        expect(mocks.generate).toHaveBeenCalledWith(payload);
    });
    it("refuses an unsigned request before fetching data or generating", async () => {
        mocks.email.mockRejectedValue(new ApiError(401, "Not signed in"));
        expect((await POST(generateRequest())).status).toBe(401);
        expect(mocks.bundle).not.toHaveBeenCalled();
        expect(mocks.generate).not.toHaveBeenCalled();
    });
    it("refuses an unassigned cohort before fetching participant records", async () => {
        mocks.access.mockRejectedValue(new ApiError(403, "Not assigned"));
        expect((await POST(generateRequest())).status).toBe(403);
        expect(mocks.bundle).not.toHaveBeenCalled();
        expect(mocks.generate).not.toHaveBeenCalled();
    });
    it("refuses a participant outside the requested cohort", async () => {
        expect((await POST(generateRequest({ ...payload, participant_id: 8 }))).status).toBe(403);
        expect(mocks.generate).not.toHaveBeenCalled();
    });
    it.each([null, {}, { ...payload, cohort_id: null }, { ...payload, cohort_id: "123" },
        { ...payload, participant_id: 0 }, { ...payload, participant_id: 1.5 }])(
        "refuses invalid identifiers: %j", async (body) => {
            expect((await POST(generateRequest(body))).status).toBe(400);
            expect(mocks.access).not.toHaveBeenCalled();
            expect(mocks.generate).not.toHaveBeenCalled();
        },
    );
    it("fails closed when cohort data is missing", async () => {
        mocks.bundle.mockResolvedValue(null);
        expect((await POST(generateRequest())).status).toBe(404);
        expect(mocks.generate).not.toHaveBeenCalled();
    });
    it("fails closed if the loader returns a different cohort", async () => {
        const other = bundle(); other.cohort.id = 456;
        mocks.bundle.mockResolvedValue(other);
        expect((await POST(generateRequest())).status).toBe(404);
        expect(mocks.generate).not.toHaveBeenCalled();
    });
});

describe("image access", () => {
    it.each(["imgs/hope/a/profile.png", "imgs/hope/a/post.jpg"])(
        "signs a verified profile or activity image: %s", async (path) => {
            const response = await GET(imageRequest(path));
            expect(response.status).toBe(302);
            expect(mocks.access).toHaveBeenCalledWith("facilitator@example.org", 123);
            expect(mocks.sign).toHaveBeenCalledWith(path, mocks.config.mock.results[0].value);
            expect(response.headers.get("Cache-Control")).toBe("private, no-store");
        },
    );
    it("refuses an unsigned request without signing", async () => {
        mocks.email.mockRejectedValue(new ApiError(401, "Not signed in"));
        expect((await GET(imageRequest())).status).toBe(401);
        expect(mocks.sign).not.toHaveBeenCalled();
    });
    it("refuses an unassigned cohort before fetching records", async () => {
        mocks.access.mockRejectedValue(new ApiError(403, "Not assigned"));
        expect((await GET(imageRequest())).status).toBe(403);
        expect(mocks.bundle).not.toHaveBeenCalled();
        expect(mocks.sign).not.toHaveBeenCalled();
    });
    it.each(["imgs/hope/other/profile.png", "imgs/hope/a/secret.png"])(
        "refuses an unlisted path even with an accessible cohort: %s", async (path) => {
            expect((await GET(imageRequest(path))).status).toBe(403);
            expect(mocks.sign).not.toHaveBeenCalled();
        },
    );
    it.each(["", "0", "-1", "1.5"])("requires a valid cohort: %s", async (cohort) => {
        expect((await GET(imageRequest(undefined, cohort))).status).toBe(400);
        expect(mocks.sign).not.toHaveBeenCalled();
    });
    it("refuses malformed paths before loading data", async () => {
        expect((await GET(imageRequest("imgs/../secret.png"))).status).toBe(400);
        expect(mocks.bundle).not.toHaveBeenCalled();
        expect(mocks.sign).not.toHaveBeenCalled();
    });
    it("does not sign when the bundle cannot be loaded", async () => {
        mocks.bundle.mockRejectedValue(new Error("Platform unavailable"));
        expect((await GET(imageRequest())).status).toBe(502);
        expect(mocks.sign).not.toHaveBeenCalled();
    });
});

describe("activity image request wiring", () => {
    it("retains the platform image and includes the cohort in its signing URL", () => {
        const data = bundle();
        const history = bundleToHistory(data, "7", 7)!;
        expect(history.events[0].image_url).toBe("/imgs/hope/a/post.jpg");
        const url = new URL(imageSrc(history.events[0].image_url, data.cohort.id)!,
            "https://dashboard.example");
        expect(url.searchParams.get("cohortId")).toBe("123");
        expect(url.searchParams.get("path")).toBe("imgs/hope/a/post.jpg");
    });
});
