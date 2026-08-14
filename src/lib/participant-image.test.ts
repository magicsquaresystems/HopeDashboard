import { describe, expect, it } from "vitest";

import { classifyParticipantImage } from "@/lib/participant-image";

const TRUSTED = ["staging.poweredbyh4c.org"];

describe("classifyParticipantImage", () => {
    it("treats an absent image as none", () => {
        for (const empty of [null, undefined, "", "   "]) {
            expect(classifyParticipantImage(empty, TRUSTED)).toEqual({
                kind: "none",
            });
        }
    });

    it("renders a stock avatar on the platform's own host", () => {
        const url =
            "https://staging.poweredbyh4c.org/assets/hope-v2/img/avatar/01.jpg";
        expect(classifyParticipantImage(url, TRUSTED)).toEqual({
            kind: "absolute",
            url,
        });
    });

    it("flags an uploaded image as needing a signed URL", () => {
        expect(
            classifyParticipantImage("images/hope/12345/my-img.png", TRUSTED),
        ).toEqual({ kind: "needs-signing", path: "images/hope/12345/my-img.png" });
    });

    it("strips a leading slash from a storage path", () => {
        expect(
            classifyParticipantImage("/images/hope/1/a.png", TRUSTED),
        ).toEqual({ kind: "needs-signing", path: "images/hope/1/a.png" });
    });

    it("refuses a host that is not on the allow-list", () => {
        // Rendering an arbitrary origin makes the dashboard fetch from
        // wherever the payload says, and leaks the viewing facilitator's
        // IP and referrer to a third party.
        expect(
            classifyParticipantImage("https://evil.example/track.png", TRUSTED),
        ).toEqual({ kind: "none" });
    });

    it("refuses a protocol-relative URL to an untrusted host", () => {
        // `//host/path` resolves to a remote origin just like an absolute
        // URL, so it must not fall through to the storage-path branch.
        expect(
            classifyParticipantImage("//evil.example/track.png", TRUSTED),
        ).toEqual({ kind: "none" });
    });

    it("refuses non-http schemes", () => {
        // The case that turns an image field into script execution.
        for (const bad of [
            "javascript:alert(1)",
            "data:text/html;base64,PHNjcmlwdD4=",
            "file:///etc/passwd",
        ]) {
            expect(classifyParticipantImage(bad, TRUSTED)).toEqual({
                kind: "none",
            });
        }
    });

    it("refuses a storage path that climbs out of its container", () => {
        expect(
            classifyParticipantImage("images/hope/../../secrets/a.png", TRUSTED),
        ).toEqual({ kind: "none" });
    });

    it("refuses everything when no host is trusted", () => {
        // An unconfigured HOPE_API_URL must not mean "trust anything".
        expect(
            classifyParticipantImage(
                "https://staging.poweredbyh4c.org/a.jpg",
                [],
            ),
        ).toEqual({ kind: "none" });
    });
});
