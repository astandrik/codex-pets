import type { MetadataRoute } from "next";

import { toPublicUrl, withBasePath } from "@/lib/base-path";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: {
      userAgent: "*",
      allow: [withBasePath("/"), withBasePath("/pets/"), withBasePath("/submit")],
      disallow: [withBasePath("/admin"), withBasePath("/api/admin")],
    },
    sitemap: toPublicUrl("/sitemap.xml"),
  };
}
