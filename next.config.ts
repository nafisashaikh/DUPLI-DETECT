import type { NextConfig } from "next";

import path from "path";

const nextConfig: NextConfig = {
  turbopack: {
    // Explicitly set the project root so Next doesn't infer the parent workspace.
    // (See node_modules/next/dist/docs/.../next-config-js/turbopack.md)
    root: path.join(__dirname),
  },
};

export default nextConfig;
