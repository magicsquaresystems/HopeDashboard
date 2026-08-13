/**
 * NextAuth v5 config.
 *
 * Edge-runtime safe: only Credentials provider is statically imported here,
 * so middleware (which runs in Edge) does not pull in Node-only modules.
 *
 * Sign-in is platform hand-off only. The Hope Move platform links a
 * facilitator here with a short-lived signed token carrying their
 * identity; there is no email form and no direct-credentials provider.
 * The old `dev-allowlist` provider (any email in open mode) was a testing
 * affordance and was removed — on a deployment fronting real participant
 * data it amounted to unauthenticated access. For local development, mint
 * a hand-off link with `scripts/mint-handoff-token.mjs`.
 *
 * `AUTH_MODE` still matters for cohort *visibility*, not sign-in: with no
 * explicit assignment, `open` shows every cohort (convenient locally),
 * `allowlist` shows none (deny-by-default; production posture). See
 * lib/server/assignments.ts.
 */

import NextAuth, { type NextAuthConfig } from "next-auth";
import Credentials from "next-auth/providers/credentials";

import { handoffSecret, verifyHandoffToken } from "@/lib/auth/handoff";

export type AuthMode = "open" | "allowlist";

export function authMode(): AuthMode {
    return process.env.AUTH_MODE === "allowlist" ? "allowlist" : "open";
}

const providers: NextAuthConfig["providers"] = [
    /**
     * The production path. The Hope Move platform links a facilitator
     * here with a short-lived signed token carrying their identity, so
     * they never see a sign-in form — they are already signed in over
     * there. See lib/auth/handoff.ts for the token format.
     */
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
    session: { strategy: "jwt" },
    pages: { signIn: "/login" },
    providers,
    callbacks: {
        async signIn({ user, account }) {
            const email = user?.email?.toLowerCase();
            if (!email) return false;
            // A verified hand-off already proves the platform vouches
            // for this person; re-checking them against our own
            // allowlist would mean maintaining the roster twice and
            // locking out a legitimate facilitator the platform just
            // onboarded. The signature is the authority here.
            //
            // Hand-off is the only provider, so anything else is denied
            // outright — a second provider added later must opt in here
            // explicitly rather than inherit access.
            return account?.provider === "platform-handoff";
        },
    },
};

export const { handlers, auth, signIn, signOut } = NextAuth(config);
