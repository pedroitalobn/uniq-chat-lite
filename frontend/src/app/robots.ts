import type { MetadataRoute } from "next";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        disallow: ["/api-docs", "/api-docs/"],
      },
      // Bloqueia bots de LLMs explicitamente
      {
        userAgent: ["GPTBot", "ChatGPT-User", "CCBot", "anthropic-ai", "Claude-Web", "PerplexityBot", "Amazonbot", "cohere-ai"],
        disallow: "/",
      },
    ],
  };
}
