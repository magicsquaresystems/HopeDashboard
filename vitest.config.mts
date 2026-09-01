import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

/**
 * Node-environment unit tests for pure logic only — the shared queue-state
 * reducer and the error classifier. Both are deliberately free of React
 * and `fs` so they can be tested without a DOM or a database, which is
 * why they live in their own modules.
 */
export default defineConfig({
    resolve: {
        alias: {
            "@": fileURLToPath(new URL("./src", import.meta.url)),
            // `server-only` exists to make importing a server module from a
            // client component a BUILD error — which is what guards the
            // Azure account key in lib/server/blob-url.ts. Outside Next's
            // bundler it resolves to a module that throws on import, so a
            // unit test of that file's pure parts could not load it. Vitest
            // is neither a client nor a server bundle; stubbing the marker
            // here lets the logic be tested without weakening the guarantee
            // where it actually applies.
            "server-only": fileURLToPath(
                new URL("./src/test/server-only-stub.ts", import.meta.url),
            ),
        },
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});
