/**
 * NextAuth v5 config.
 *
 * Edge-runtime safe: only Credentials providers are statically imported
 * here, so middleware (which runs in Edge) does not pull in Node-only
 * modules.
 *
 * There are two ways in, and both start on the Hope Move platform —
 * there is no email form and no direct-credentials provider. The old
 * `dev-allowlist` provider (any email in open mode) was a testing
 * affordance and was removed: on a deployment fronting real participant
 * data it amounted to unauthenticated access.
 *
 *   `hope-platform`   The production path. Hope redirects to
 *                     `/auth/callback?code=…`; we trade that code for an
 *                     access + refresh pair and read the facilitator's
 *                     identity out of the access token. This is the only
 *                     route that yields credentials for Hope's own API.
 *
 *   `platform-handoff` The original path, kept. Hope mints a short-lived
 *                     signed token carrying an email. It grants a session
 *                     but no platform API access, and it is how local
 *                     development signs in at all — see
 *                     `scripts/mint-handoff-token.mjs`.
 *
 * `AUTH_MODE` still matters for cohort *visibility*, not sign-in: with no
 * explicit assignment, `open` shows every cohort (convenient locally),
 * `allowlist` shows none (deny-by-default; production posture). See
 * lib/server/assignments.ts.
 */

import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { handoffSecret, verifyHandoffToken } from "@/lib/auth/handoff";
import {
    exchangeCode,
    hopeConfig,
    refreshTokens,
} from "@/lib/auth/hope-exchange";
import {
    decodeJwtClaims,
        hasSyntheticEmail,
    type HopeTokens,
    needsRefresh,
    resolveFacilitator,
} from "@/lib/auth/hope-token";

export type AuthMode = "open" | "allowlist";

/** Bounded by the platform's refresh-token lifetime. A session that
 *  outlives the credential it carries is a session that looks live and
 *  fails on every call.
 *
 *  This is no longer the thing that ends a session in practice, and it
 *  is left long on purpose. API routes now refuse a session whose Hope
 *  link has broken (`lib/auth/session-gate.ts`), so the link dies first
 *  and the cookie's own expiry is only the outer bound. Shortening it
 *  would log out facilitators whose link is perfectly healthy. */
const SESSION_MAX_AGE_S = 30 * 24 * 60 * 60;

/** Providers allowed to create a session. A provider added later must
 *  be listed here explicitly rather than inheriting access. */
const ALLOWED_PROVIDERS = new Set(["platform-handoff", "hope-platform"]);

export function authMode(): AuthMode {
    return process.env.AUTH_MODE === "allowlist" ? "allowlist" : "open";
}

declare module "next-auth" {
    interface Session {
        /** The platform's own identifier for this facilitator. */
        hopeUserId?: string;
        /** True when this session carries Hope API credentials. */
        hopeLinked?: boolean;
        /** Set when the platform link has broken and re-auth is needed. */
        error?: string;
    }
}

declare module "next-auth/jwt" {
    interface JWT {
        hopeUserId?: string;
        /** Server-side only — deliberately never surfaced through the
         *  `session` callback. See lib/auth/hope-session.ts. */
        hope?: HopeTokens;
        error?: string;
    }
}

const providers: NextAuthConfig["providers"] = [
    Credentials({
        id: "hope-platform",
        name: "Hope Move",
        credentials: { code: { label: "Authorization code", type: "text" } },
        async authorize(input) {
            const code = String(input?.code ?? "");
            const config = hopeConfig();
            if (!code || !config) return null;

            const exchanged = await exchangeCode(config, code);
            if (!exchanged) return null;
            const { tokens, user } = exchanged;

            // The platform sends the identity beside the tokens, so a
            // token whose claims we cannot read is no longer fatal —
            // hence `?? {}` rather than refusing here.
            const claims = decodeJwtClaims(tokens.accessToken) ?? {};

            const who = resolveFacilitator(claims, user);
            if (!who) {
                // Refused rather than guessed: with neither an explicit
                // userId nor a usable id claim, every facilitator's work
                // would be attributed to the same empty string.
                console.error(
                    "hope auth: no userId in the exchange response and no " +
                        "usable id claim in the access token — saw " +
                        `[${Object.keys(claims).join(", ")}]`,
                );
                return null;
            }

            if (hasSyntheticEmail(who.email)) {
                console.warn(
                    "hope auth: no email claim in the access token; using a " +
                        "synthetic address. Cohort assignment by email will " +
                        "not match, so `allowlist` mode will grant nothing.",
                );
            }

            return {
                id: who.hopeUserId,
                email: who.email,
                name: who.name ?? who.email.split("@")[0],
                hopeUserId: who.hopeUserId,
                hope: tokens,
            };
        },
    }),

    Credentials({
        id: "platform-handoff",
        name: "Hope Move platform",
        credentials: { token: { label: "Handoff token", type: "text" } },
        async authorize(input) {
            const token = String(input?.token ?? "");
            const secret = handoffSecret();
            if (!token || !secret) return null;
            const result = await verifyHandoffToken(token, secret);
            if (!result.ok) {
                console.warn(`handoff rejected: ${result.reason}`);
                return null;
            }
            const { email, name } = result.claims;
            return { id: email, email, name: name ?? email.split("@")[0] };
        },
    }),
];

export const config: NextAuthConfig = {
    trustHost: true,
    session: { strategy: "jwt", maxAge: SESSION_MAX_AGE_S },
    pages: { signIn: "/login" },
    providers,
    callbacks: {
        async signIn({ user, account }) {
            const email = user?.email?.toLowerCase();
            if (!email) return false;
            // A verified hand-off or a completed code exchange already
            // proves the platform vouches for this person; re-checking
            // them against our own allowlist would mean maintaining the
            // roster twice and locking out a legitimate facilitator the
            // platform just onboarded. The platform is the authority.
            return ALLOWED_PROVIDERS.has(account?.provider ?? "");
        },

        /**
         * Also the refresh point.
         *
         * This runs on every `auth()` call, including from middleware, so
         * it must stay cheap in the common case — and it does: a network
         * call happens only inside the skew window, so at most once per
         * access-token lifetime per facilitator, not once per request.
         */
        async jwt({ token, user }) {
            if (user) {
                const linked = user as {
                    hopeUserId?: string;
                    hope?: HopeTokens;
                };
                if (linked.hopeUserId && linked.hope) {
                    token.hopeUserId = linked.hopeUserId;
                    token.hope = linked.hope;
                    delete token.error;
                }
            }

            const hope = token.hope;
            if (!hope) return token; // hand-off session: nothing to refresh
            if (!needsRefresh(hope.expiresAt, Date.now())) return token;

            const cfg = hopeConfig();
            if (!cfg) {
                token.error = "hope_not_configured";
                return token;
            }

            const next = await refreshTokens(cfg, hope.refreshToken);
            if (!next) {
                // The refresh fires REFRESH_SKEW_MS before expiry, so a
                // failed attempt usually leaves an access token that is
                // still good. Keep serving it and retry on the next
                // request: with rotating refresh tokens and serverless
                // instances, two concurrent requests can race the same
                // rotation, and killing the session on the first loser
                // signs a facilitator out mid-visit for no user-visible
                // reason. Multiplied across many facilitators that is a
                // steady drip of spurious sign-outs.
                if (Date.now() < hope.expiresAt) return token;
                // Actually dead. Drop the pair rather than keeping it:
                // holding an expired token turns every downstream call
                // into an opaque 401; clearing it lets the session end
                // cleanly and send the facilitator back to the platform.
                delete token.hope;
                token.error = "hope_refresh_failed";
                return token;
            }

            // The platform rotates the refresh token, so store what came
            // back and discard what we sent.
            token.hope = next.tokens;
            delete token.error;
            return token;
        },

        /**
         * What the browser is allowed to see.
         *
         * The object returned here is served by `/api/auth/session` and
         * read by `useSession()`, so it is public. Access and refresh
         * tokens must never be added to it — server code reads them from
         * the underlying JWT via lib/auth/hope-session.ts.
         */
        async session({ session, token }) {
            session.hopeUserId = token.hopeUserId;
            session.hopeLinked = Boolean(token.hope);
            session.error = token.error;
            return session;
        },
    },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
