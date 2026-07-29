import type { MetadataRoute } from "next";

import { withBasePath } from "@/lib/base-path";
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE } from "@/lib/site-metadata";

export default function manifest(): MetadataRoute.Manifest {
  // With a base path, "/codex-pets" has a default manifest scope of "/";
  // pin an explicit trailing-slash scope and keep start_url inside it.
  const rootUrl = withBasePath("/");
  const scopedRootUrl = rootUrl.endsWith("/") ? rootUrl : `${rootUrl}/`;

  return {
    name: SITE_TITLE,
    short_name: SITE_NAME,
    description: SITE_DESCRIPTION,
    start_url: scopedRootUrl,
    scope: scopedRootUrl,
    display: "standalone",
    background_color: "#151617",
    theme_color: "#151617",
    icons: [
      {
        src: withBasePath("/favicon.svg"),
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: withBasePath("/assets/brand-icon-192.png"),
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: withBasePath("/assets/brand-icon-512.png"),
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
