/**
 * Stands in for the `server-only` marker package under Vitest.
 *
 * That package deliberately throws when imported outside a React Server
 * Component, which is what makes it a useful guard on modules holding
 * credentials. A unit test is neither environment, so importing the real
 * one would fail before a single assertion ran. Aliased in
 * `vitest.config.ts`; the real marker still applies to every build.
 */
export {};
