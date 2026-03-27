import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  experimental: {
    serverActions: {
      allowedOrigins: ["localhost:3010", "localhost:3000"],
    },
  },
  images: {
    remotePatterns: [],
  },
};

export default nextConfig;
