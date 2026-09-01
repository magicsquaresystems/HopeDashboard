import { describe, expect, it } from "vitest";

import { imageSrc } from "./image-src";

/**
 * The platform sends two different things in one field: an absolute URL
 * when the participant picked a Hope library avatar, an Azure blob path
 * when they uploaded a photo. Only the second needs signing, and getting
 * the distinction wrong shows every participant a broken image.
 */
describe("imageSrc", () => {
    it("returns a Hope library avatar URL unchanged", () => {
        const url = "https://staging.poweredbyh4c.org/assets/hope-v2/img/avatar/05.png";
        expect(imageSrc(url)).toBe(url);
    });

    it("routes an uploaded photo through the signing proxy", () => {
        const src = imageSrc("imgs/hope/471dd567-c1e6-499f/profile-pic.png");
        expect(src).toBe(
            "/api/proxy/blob?path=imgs%2Fhope%2F471dd567-c1e6-499f%2Fprofile-pic.png",
        );
    });

    it("keeps the path inside one query parameter", () => {
        // Unencoded slashes would reshape the URL into a different route.
        const src = imageSrc("a/b/c.jpg")!;
        const url = new URL(src, "https://example.org");
        expect(url.pathname).toBe("/api/proxy/blob");
        expect(url.searchParams.get("path")).toBe("a/b/c.jpg");
    });

    it("tolerates a leading slash on a blob path", () => {
        const url = new URL(imageSrc("/imgs/hope/x.jpg")!, "https://example.org");
        expect(url.searchParams.get("path")).toBe("imgs/hope/x.jpg");
    });

    it("has nothing to show for empty values", () => {
        expect(imageSrc(null)).toBeNull();
        expect(imageSrc(undefined)).toBeNull();
        expect(imageSrc("   ")).toBeNull();
    });

    it("treats a protocol-relative URL as absolute rather than a blob path", () => {
        expect(imageSrc("//cdn.example.org/a.png")).toBe("//cdn.example.org/a.png");
    });
});
