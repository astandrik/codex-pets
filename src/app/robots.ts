import type { MetadataRoute } from "next";

import { toPublicUrl, withBasePath } from "@/lib/base-path";

const PUBLIC_ALLOW_PATHS = [
  "/",
  "/about",
  "/agents",
  "/developers",
  "/docs/api",
  "/guides/",
  "/pets/",
  "/users/",
  "/request",
  "/submit",
  "/llm.txt",
  "/llms.txt",
  "/llms-full.txt",
  "/openapi.json",
  "/api/openapi.json",
  "/server.json",
  "/.well-known/mcp/server.json",
];

const PUBLIC_DISALLOW_PATHS = ["/admin", "/api/admin"];

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
