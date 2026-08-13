#!/usr/bin/env node
/**
 * Mint a platform hand-off link, for testing the entry flow without the
 * Hope Move platform in the loop.
 *
 *   node scripts/mint-handoff-token.mjs facilitator@hope.org 1680
 *
 * Reads HOPE_HANDOFF_SECRET (falling back to AUTH_SECRET) from
 * .env.local. Prints a ready-to-open URL. The token is valid for two
 * minutes — the same window the real platform should use.
 *
 * This is the reference implementation of the token format for the
 * platform engineer: base64url(JSON) + "." + base64url(HMAC-SHA256).
 */

import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";

const [, , emailArg, cohortArg] = process.argv;
if (!emailArg) {
    console.error(
        "usage: node scripts/mint-handoff-token.mjs <email> [cohortId]",
    );
    process.exit(1);
}

function readEnv(name) {
    if (process.env[name]) return process.env[name];
    const file = path.join(process.cwd(), ".env.local");
    if (!fs.existsSync(file)) return undefined;
    for (const line of fs.readFileSync(file, "utf8").split(/\r?\n/)) {
        const m = line.match(new RegExp(`^\\s*${name}\\s*=\\s*(.*)$`));
        if (m) return m[1].trim().replace(/^["']|["']$/g, "");
    }
    return undefined;
}

const secret = readEnv("HOPE_HANDOFF_SECRET") ?? readEnv("AUTH_SECRET");
if (!secret) {
    console.error("No HOPE_HANDOFF_SECRET or AUTH_SECRET found in env/.env.local");
    process.exit(1);
}

const b64url = (buf) =>
    Buffer.from(buf).toString("base64url");

const payload = {
    email: emailArg.toLowerCase(),
    name: emailArg.split("@")[0],
    exp: Math.floor(Date.now() / 1000) + 120,
};
const encoded = b64url(JSON.stringify(payload));
const sig = b64url(
    crypto.createHmac("sha256", secret).update(encoded).digest(),
);
const token = `${encoded}.${sig}`;

const base = readEnv("AUTH_URL") ?? "http://localhost:3000";
const url = new URL("/enter", base);
url.searchParams.set("token", token);
if (cohortArg) url.searchParams.set("cohortId", cohortArg);

console.log(url.toString());
