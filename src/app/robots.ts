import type { MetadataRoute } from "next";

import { toPublicUrl, withBasePath } from "@/lib/base-path";

const PUBLIC_ALLOW_PATHS = [
  "/",
  "/about",
  "/agents",
  "/agents.md",
  "/developers",
  "/developers/llms.txt",
  "/docs/api",
  "/docs/llms.txt",
  "/guides/",
  "/pets/",
  "/users/",
  "/request",
  "/submit",
  "/pricing",
  "/pricing.md",
  "/terms",
  "/terms.md",
  "/index.md",
  "/about.md",
  "/developers.md",
  "/docs/api.md",
  "/mcp.md",
  "/auth.md",
  "/llm.txt",
  "/llms.txt",
  "/llms-full.txt",
  "/openapi.json",
  "/api/openapi.json",
  "/.well-known/mcp",
  "/server.json",
  "/.well-known/mcp/server.json",
  "/.well-known/mcp/server-card.json",
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-protected-resource/mcp",
];

const PUBLIC_DISALLOW_PATHS = ["/admin", "/api/admin", "/api/"];

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: PUBLIC_ALLOW_PATHS.map(withBasePath),
        disallow: PUBLIC_DISALLOW_PATHS.map(withBasePath),
      },
      {
        userAgent: "OAI-SearchBot",
        allow: PUBLIC_ALLOW_PATHS.map(withBasePath),
        disallow: PUBLIC_DISALLOW_PATHS.map(withBasePath),
      },
      {
        userAgent: "GPTBot",
        allow: PUBLIC_ALLOW_PATHS.map(withBasePath),
        disallow: PUBLIC_DISALLOW_PATHS.map(withBasePath),
      },
    ],
    sitemap: toPublicUrl("/sitemap.xml"),
  };
}
