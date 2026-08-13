/**
 * HMAC-SHA256 request signer for server-side calls into the
 * comment_generation FastAPI. Browser environments must never see the
 * shared secret — this module assumes a Node runtime (Route Handler,
 * Server Action, or Server Component fetch).
 */

import { createHmac } from "node:crypto";

const SECRET = process.env.HOPE_API_SECRET;

if (typeof window !== "undefined") {
    throw new Error(
        "lib/auth/sign.ts must not be imported in browser code; " +
            "use it only from server-side Next.js code paths.",
    );
}

export function signRequest(rawBody: string): string {
    if (!SECRET) {
        throw new Error("HOPE_API_SECRET is not set");
    }
    return createHmac("sha256", SECRET).update(rawBody).digest("hex");
}

export function signerOrUndefined(): ((body: string) => Promise<string>) | undefined {
    if (!SECRET) return undefined;
    return async (body: string) => signRequest(body);
}
