import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next.js doesn't get confused by stray
  // lockfiles in parent directories (e.g. the home folder).
  turbopack: {
    root: __dirname,
  },
  // Next 16 writes editor tooling instruction files into the repo root
  // on every dev and build run. They were deleted once already (5569e42)
  // and came straight back, and since routine commits stage everything,
  // they are one `git add -A` away from landing in a shared repo.
  // Nothing in this project reads them.
  agentRules: false,
};

export default nextConfig;
