import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  compress: false,
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
  // /reports/* foi movido pra dentro do inbox — redirect pra não quebrar
  // bookmarks e o link do menu antigo.
  async redirects() {
    return [
      { source: "/reports", destination: "/inbox?view=reports", permanent: false },
      { source: "/reports/:path*", destination: "/inbox?view=reports", permanent: false },
    ];
  },
};

export default nextConfig;
