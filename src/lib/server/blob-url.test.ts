import { describe, expect, it } from "vitest";

import { normaliseBlobPath, signedBlobUrl, type BlobConfig } from "./blob-url";

/**
 * The account key this module holds grants read and write over every
 * participant's uploaded content. These pin the two things that keep that
 * blast radius small: what the module refuses to sign, and how little the
 * URL it produces can do.
 */
describe("normaliseBlobPath", () => {
    it("accepts a platform blob path", () => {
        expect(normaliseBlobPath("imgs/hope/471dd567/photo.jpg")).toBe(
            "imgs/hope/471dd567/photo.jpg",
        );
    });

    it("strips leading slashes rather than rejecting them", () => {
        // The platform is inconsistent about these and it names the same blob.
        expect(normaliseBlobPath("/imgs/hope/x.jpg")).toBe("imgs/hope/x.jpg");
    });

    it.each([
        ["a parent-directory segment", "imgs/../../secrets/key.txt"],
        ["a bare parent segment", "../key.txt"],
        ["a current-directory segment", "imgs/./x.jpg"],
        ["an empty segment", "imgs//x.jpg"],
        ["a backslash", "imgs\\hope\\x.jpg"],
        ["an absolute https URL", "https://evil.example/x.jpg"],
        ["a protocol-relative URL", "//evil.example/x.jpg"],
        ["a non-http scheme", "file:///etc/passwd"],
        ["nothing at all", "   "],
    ])("refuses %s", (_label, value) => {
        expect(normaliseBlobPath(value)).toBeNull();
    });
});

describe("signedBlobUrl", () => {
    const config: BlobConfig = {
        accountName: "hopeusercontent",
        // Any valid base64 — the signature is not asserted, only the shape
        // of what surrounds it.
        accountKey: Buffer.from("test-key-material").toString("base64"),
        container: "user-content",
    };
    const now = Date.parse("2026-08-24T12:00:00Z");

    it("addresses the blob in the right account and container", () => {
        const url = new URL(signedBlobUrl("imgs/hope/a.jpg", config, now));
        expect(url.host).toBe("hopeusercontent.blob.core.windows.net");
        expect(url.pathname).toBe("/user-content/imgs/hope/a.jpg");
    });

    it("grants read only, over https only, for minutes not hours", () => {
        const url = new URL(signedBlobUrl("imgs/hope/a.jpg", config, now));
        const q = url.searchParams;
        expect(q.get("sp")).toBe("r");
        expect(q.get("spr")).toBe("https");
        const expiry = Date.parse(q.get("se")!);
        const ttlMinutes = (expiry - now) / 60_000;
        expect(ttlMinutes).toBeGreaterThan(0);
        expect(ttlMinutes).toBeLessThanOrEqual(15);
    });

    it("starts validity before now, so a fast clock cannot void it", () => {
        const url = new URL(signedBlobUrl("imgs/hope/a.jpg", config, now));
        expect(Date.parse(url.searchParams.get("st")!)).toBeLessThan(now);
    });

    it("never puts the account key in the URL", () => {
        const url = signedBlobUrl("imgs/hope/a.jpg", config, now);
        expect(url).not.toContain(config.accountKey);
    });

    it("escapes a path segment rather than letting it alter the URL", () => {
        const url = new URL(signedBlobUrl("imgs/a b?c.jpg", config, now));
        expect(url.pathname).toBe("/user-content/imgs/a%20b%3Fc.jpg");
    });
});
