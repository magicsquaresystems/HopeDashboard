import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Pin the workspace root so Next.js doesn't get confused by stray
  // lockfiles in parent directories (e.g. the home folder).
  turbopack: {
    root: __dirname,
  },
};

export default nextConfig;
