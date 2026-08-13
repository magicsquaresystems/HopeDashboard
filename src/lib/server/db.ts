/**
 * Optional Postgres connection, shared by the server-side stores.
 *
 * The dashboard has no database in local development and must not
 * require one: `DATABASE_URL` unset means every store falls back to its
 * file/env driver, and `npm run dev` works on a fresh clone. Set it and
 * the same code paths persist to Postgres instead — which is what a
 * Vercel deployment needs, because serverless instances share no disk
 * and are recycled between requests.
 *
 * Vendor-neutral on purpose: Neon (the Vercel marketplace default),
 * Supabase, Azure, and Railway all hand out a plain `DATABASE_URL`.
 *
 * The pool is memoised on `globalThis` rather than a module-level
 * binding because Next's dev server re-evaluates modules on every hot
 * reload; a plain `let` would leak a new pool per edit until Postgres
 * refused connections.
 */

import type { Pool } from "pg";

if (typeof window !== "undefined") {
    throw new Error("db.ts must not be imported in client code");
}

const g = globalThis as typeof globalThis & { __hopePool?: Pool };

export function databaseUrl(): string | null {
    const raw = process.env.DATABASE_URL?.trim();
    return raw ? raw : null;
}

/** True when a Postgres backend is configured. */
export function hasDatabase(): boolean {
    return databaseUrl() !== null;
}

/**
 * Lazily constructs the pool. `pg` is imported dynamically so that a
 * deployment without a database never loads the driver at all.
 */
export async function getPool(): Promise<Pool> {
    const url = databaseUrl();
    if (!url) throw new Error("DATABASE_URL is not set");
    if (g.__hopePool) return g.__hopePool;
    const { Pool: PgPool } = await import("pg");
    g.__hopePool = new PgPool({
        connectionString: url,
        // Managed Postgres (Neon/Supabase/Azure) terminates TLS with
        // certificates Node won't chain by default. Local Postgres has
        // no TLS at all, hence the URL sniff.
        ssl: /\blocalhost\b|\b127\.0\.0\.1\b/.test(url)
            ? undefined
            : { rejectUnauthorized: false },
        max: 5,
        idleTimeoutMillis: 30_000,
    });
    return g.__hopePool;
}

/**
 * Creates the dashboard's tables if they don't exist. Called once per
 * process on first store access — idempotent, and cheap enough that
 * carrying a migration tool for two tables isn't worth it. Re-run
 * safely; adding a column later means adding an `ALTER TABLE … IF NOT
 * EXISTS` here.
 */
export async function ensureSchema(): Promise<void> {
    if (g.__hopeSchemaReady) return g.__hopeSchemaReady;
    g.__hopeSchemaReady = (async () => {
        const pool = await getPool();
        await pool.query(`
            CREATE TABLE IF NOT EXISTS facilitator_cohorts (
                email      TEXT    NOT NULL,
                cohort_id  INTEGER NOT NULL,
                PRIMARY KEY (email, cohort_id)
            );
            CREATE TABLE IF NOT EXISTS queue_state (
                cohort_id      INTEGER NOT NULL,
                participant_id TEXT    NOT NULL,
                kind           TEXT    NOT NULL,
                by_email       TEXT    NOT NULL,
                at_ms          BIGINT  NOT NULL,
                until_ms       BIGINT,
                action         TEXT,
                PRIMARY KEY (cohort_id, participant_id, kind)
            );
        `);
    })();
    return g.__hopeSchemaReady;
}

declare global {
    var __hopeSchemaReady: Promise<void> | undefined;
}
