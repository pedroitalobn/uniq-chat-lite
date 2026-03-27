import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  experimental: {
    serverActions: {
      allowedOrigins: [
        "localhost:3010",
        "localhost:3000",
        "app.uniq.chat",
        "uniq.chat",
        "www.uniq.chat",
        "api.uniq.chat",
      ],
    },
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "media.uniq.chat",
      },
    ],
  },
};

export default nextConfig;
