import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: false,
  async headers() {
    return [
      {
        source: "/_next/static/(.*)",
        headers: [
          { key: "Cache-Control", value: "public, max-age=31536000, immutable" },
          { key: "X-Content-Type-Options", value: "nosniff" },
        ],
      },
    ];
  },
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
