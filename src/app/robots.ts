import type { MetadataRoute } from "next";

import { toPublicUrl, withBasePath } from "@/lib/base-path";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: "*",
        allow: [
          withBasePath("/"),
          withBasePath("/about"),
          withBasePath("/pets/"),
          withBasePath("/request"),
          withBasePath("/submit"),
          withBasePath("/llm.txt"),
          withBasePath("/llms.txt"),
        ],
        disallow: [withBasePath("/admin"), withBasePath("/api/admin")],
      },
      {
        userAgent: "OAI-SearchBot",
        allow: [
          withBasePath("/"),
          withBasePath("/about"),
          withBasePath("/pets/"),
          withBasePath("/request"),
          withBasePath("/submit"),
          withBasePath("/llm.txt"),
          withBasePath("/llms.txt"),
        ],
        disallow: [withBasePath("/admin"), withBasePath("/api/admin")],
      },
      {
        userAgent: "GPTBot",
        allow: [
          withBasePath("/"),
          withBasePath("/about"),
          withBasePath("/pets/"),
          withBasePath("/request"),
          withBasePath("/submit"),
          withBasePath("/llm.txt"),
          withBasePath("/llms.txt"),
        ],
        disallow: [withBasePath("/admin"), withBasePath("/api/admin")],
      },
    ],
    sitemap: toPublicUrl("/sitemap.xml"),
  };
}
