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
        },
    },
    test: {
        environment: "node",
        include: ["src/**/*.test.ts"],
    },
});
