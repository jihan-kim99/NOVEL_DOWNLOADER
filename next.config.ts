import type { NextConfig } from "next";

const isCapacitorBuild = process.env.CAPACITOR_BUILD === "1";

const nextConfig: NextConfig = isCapacitorBuild
  ? {
      output: "export",
      images: {
        unoptimized: true,
      },
    }
  : {};

export default nextConfig;
