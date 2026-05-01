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
  // Cache headers — HTML dinâmico nunca pode ficar cacheado pelo browser
  // (chunks no HTML mudam a cada deploy; cache de 1h faz user ver "page
  // failed to load" até dar refresh manual). Assets estáticos com hash no
  // path permanecem com cache imutável.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, max-age=0",
          },
        ],
      },
      {
        source: "/_next/static/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "public, max-age=31536000, immutable",
          },
        ],
      },
      {
        source: "/api-docs",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
        ],
      },
      {
        source: "/api-docs/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow, noarchive, nosnippet, noimageindex" },
        ],
      },
    ];
  },
};

export default nextConfig;
