/**
 * Server-only client factories. Import from Route Handlers / Server
 * Components / Server Actions; never from client components, since these
 * pull in the HMAC signer which depends on `node:crypto` and the secret.
 */

// Defensive guard since `server-only` is bundled but importable through next:
if (typeof window !== "undefined") {
    throw new Error("lib/api/server.ts must not be imported in browser code");
}

import { signerOrUndefined } from "@/lib/auth/sign";
import { createCommentGenClient } from "@/lib/api/commentGen";
import { createDropoutClient } from "@/lib/api/dropout";

/**
 * The hosted Spaces are the default, not localhost.
 *
 * Both URLs are public identifiers rather than secrets, and this app is
 * built for one deployment, so defaulting to the services it actually
 * uses means a deployment only has to be given the three credentials
 * that genuinely cannot live in the repo. The previous localhost
 * defaults meant an unset variable pointed production at a machine that
 * does not exist, which surfaces as an unreachable backend rather than
 * as the missing configuration it is.
 *
 * Anyone running the backends locally sets these in `.env.local`.
 */
const COMMENT_GEN_URL =
    process.env.COMMENT_GEN_URL ??
    "https://h4cdev-hope-comment-gen-api.hf.space";
const DROPOUT_API_URL =
    process.env.DROPOUT_API_URL ?? "https://h4cdev-hope-dropout-api.hf.space";

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
        baseUrl: COMMENT_GEN_URL,
        sign: signerOrUndefined(),
        authToken: HF_TOKEN,
    });
}

export function dropoutApi() {
    return createDropoutClient({
        baseUrl: DROPOUT_API_URL,
        apiKey: HOPE_RISK_API_KEY,
        authToken: HF_TOKEN,
    });
}
