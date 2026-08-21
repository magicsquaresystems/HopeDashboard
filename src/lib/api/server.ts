/**
 * Server-only client factories. Import from Route Handlers / Server
 * Components / Server Actions; never from client components, since these
 * pull in the HMAC signer which depends on `node:crypto` and the secret.
 */

// Defensive guard since `server-only` is bundled but importable through next:
if (typeof window !== "undefined") {
    throw new Error("lib/api/server.ts must not be imported in browser code");
}

import { ApiError } from "@/lib/api/client";
import { signerOrUndefined } from "@/lib/auth/sign";
import { createCommentGenClient } from "@/lib/api/commentGen";
import { createDropoutClient } from "@/lib/api/dropout";

/**
 * Backend URLs come from the environment, with no default.
 *
 * There was a fallback to the hosted Spaces here. It made an unset
 * variable invisible: the deployment quietly worked, so nobody could
 * tell a configured deployment from an unconfigured one, and a
 * diagnostic reading `process.env` reported "not configured" about a
 * service that was answering perfectly well. Configuration that can be
 * wrong silently is worse than configuration that is missing loudly.
 *
 * Resolved per call rather than at module load, and reported as a 503
 * with a code the UI already understands. Throwing at import time would
 * take down every route in the bundle — including the pages that would
 * have explained the problem — for one missing string.
 *
 * These are public identifiers, not secrets. `.env.example` carries the
 * values this deployment uses.
 */
function requiredBackendUrl(name: "COMMENT_GEN_URL" | "DROPOUT_API_URL"): string {
    const value = process.env[name]?.trim();
    if (!value) {
        throw new ApiError(
            503,
            `This deployment is missing ${name}, so that service cannot be reached.`,
            "backend_not_configured",
        );
    }
    return value.replace(/\/+$/, "");
}

/**
 * `HF_TOKEN` is required to invoke private HF Spaces. Empty in pure-local
 * dev (when the backends run on `localhost:*`); set to a read-scoped token
 * in production where the backends live behind `*.hf.space`.
 *
 * `HOPE_RISK_API_KEY` is engagement_ml's `X-API-Key`. Must match the value
 * configured as the `API_KEY` secret on the hope-dropout-api Space.
 */
const HF_TOKEN = process.env.HF_TOKEN || undefined;
const HOPE_RISK_API_KEY = process.env.HOPE_RISK_API_KEY || undefined;

export function commentGen() {
    return createCommentGenClient({
        baseUrl: requiredBackendUrl("COMMENT_GEN_URL"),
        sign: signerOrUndefined(),
        authToken: HF_TOKEN,
    });
}

export function dropoutApi() {
    return createDropoutClient({
        baseUrl: requiredBackendUrl("DROPOUT_API_URL"),
        apiKey: HOPE_RISK_API_KEY,
        authToken: HF_TOKEN,
    });
}
