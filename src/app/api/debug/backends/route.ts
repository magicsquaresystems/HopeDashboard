import { auth } from "@/auth";
import { postingPolicy } from "@/lib/server/posting-policy";
import { firestoreConfig, hasFirestore } from "@/lib/server/firestore";

/**
 * TEMPORARY diagnostic for the two backend services. Remove once the
 * risk and drafting proxies work on the deployment.
 *
 * The dashboard reaches engagement_ml and comment_generation through
 * server-side env vars that only the team owning the Vercel project can
 * set. When one is missing the facilitator sees a 502 and the reason
 * sits in logs we cannot read, so this reports which vars the running
 * deployment actually has and whether each service answers.
 *
 * Secrets are never returned, only whether they are set and their
 * length — enough to catch an empty or truncated paste. The two URLs
 * are returned in full because they are not secret and a wrong one is
 * the likeliest misconfiguration.
 */
/**
 * Facilitator session, not a shared key.
 *
 * This route was gated on a hardcoded key. The repository is public, so
 * the key was published with it — anyone who read the source could ask
 * production which variables were set, how long each secret was, which
 * Firebase project backed it, and whether the backends were reachable.
 * No values and no participant data, but a complete map of the
 * deployment handed to whoever wanted one.
 *
 * A session is the right gate: the people who need this are signed-in
 * staff, and it cannot be published by accident because there is
 * nothing to publish.
 */
async function isSignedIn(): Promise<boolean> {
    const session = await auth();
    return Boolean(session?.user?.email);
}

function describeSecret(value: string | undefined) {
    const trimmed = value?.trim();
    return { set: Boolean(trimmed), length: trimmed?.length ?? 0 };
}

async function probe(
    url: string | undefined,
    headers: Record<string, string>,
): Promise<Record<string, unknown>> {
    if (!url) return { skipped: "no url configured" };
    try {
        const res = await fetch(`${url.replace(/\/+$/, "")}/health`, {
            headers,
            cache: "no-store",
            signal: AbortSignal.timeout(20_000),
        });
        const text = await res.text();
        return { status: res.status, body: text.slice(0, 200) };
    } catch (err) {
        return { error: (err as Error).message };
    }
}

export async function GET() {
    // 404, not 403: an unauthenticated caller learns nothing, not even
    // that this route exists.
    if (!(await isSignedIn())) {
        return new Response(null, { status: 404 });
    }

    const hfToken = process.env.HF_TOKEN?.trim();
    const dropoutUrl = process.env.DROPOUT_API_URL?.trim();
    const commentGenUrl = process.env.COMMENT_GEN_URL?.trim();
    const authHeaders: Record<string, string> = hfToken
        ? { Authorization: `Bearer ${hfToken}` }
        : {};

    return Response.json({
        env: {
            DROPOUT_API_URL: dropoutUrl ?? null,
            COMMENT_GEN_URL: commentGenUrl ?? null,
            HF_TOKEN: describeSecret(process.env.HF_TOKEN),
            HOPE_RISK_API_KEY: describeSecret(process.env.HOPE_RISK_API_KEY),
            HOPE_API_SECRET: describeSecret(process.env.HOPE_API_SECRET),
            HOPE_API_AUTH: process.env.HOPE_API_AUTH ?? null,
            AUTH_MODE: process.env.AUTH_MODE ?? null,
            // `parsed` is the field worth having: a base64 blob that is
            // set but malformed is treated as unconfigured and only
            // logged, so from outside this is the one way to tell that
            // apart from not being set at all.
            FIREBASE_SERVICE_ACCOUNT: {
                ...describeSecret(process.env.FIREBASE_SERVICE_ACCOUNT),
                parsed: hasFirestore(),
            },
            FIREBASE_DATABASE_ID: process.env.FIREBASE_DATABASE_ID ?? null,
        },
        // Neither the project nor the database name is a secret, and a
        // deployment pointed at the wrong project is the likeliest
        // misconfiguration. The client email and key never appear here.
        // Which build is answering, and from which commit.
        //
        // Vercel bakes environment variables in at build time, so a
        // variable added after the running deployment was built has no
        // effect until something triggers a rebuild. Twice now that has
        // looked identical to "the value is wrong", and the two have
        // opposite fixes. This makes them distinguishable: compare the
        // commit against what was pushed, and the deployment id against
        // the one the page carries.
        build: {
            deploymentId: process.env.VERCEL_DEPLOYMENT_ID ?? null,
            commit: process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null,
            environment: process.env.VERCEL_ENV ?? null,
        },
        firebaseProjectId: firestoreConfig()?.projectId ?? null,
        // Whether this deployment can post to participants, and where.
        // The route checks dry-run LAST, after every validation gate, so
        // there is no way to discover this state by probing without
        // sending a real reply — which is the one action that cannot be
        // undone. Reporting it here is what makes the go-live switch
        // checkable before it is thrown.
        posting: (() => {
            const policy = postingPolicy();
            return {
                enabled: policy.enabled,
                dryRun: policy.dryRun,
                allow:
                    policy.allow === "all"
                        ? "ALL COHORTS"
                        : {
                              ids: [...policy.allow.ids],
                              codes: [...policy.allow.codes],
                          },
            };
        })(),
        queueStateBackend: hasFirestore() ? "firestore" : "files",
        dropout: await probe(dropoutUrl, authHeaders),
        commentGen: await probe(commentGenUrl, authHeaders),
    });
}
