import type { NextConfig } from "next";
import { dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(fileURLToPath(import.meta.url));
const configuredBasePath = process.env.NEXT_PUBLIC_BASE_PATH?.trim() ?? "";
const basePath =
  configuredBasePath && configuredBasePath !== "/"
    ? `/${configuredBasePath.replace(/^\/+|\/+$/g, "")}`
    : undefined;

const htmlLimitedBotUserAgents = [
  "TelegramBot",
  "WebpageBot",
  // Next 16.0.10 defaults; setting htmlLimitedBots overrides the built-in list.
  "Googlebot",
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "[\\w-]+-Google",
  "Google-[\\w-]+",
  "Chrome-Lighthouse",
  "Slurp",
  "DuckDuckBot",
  "baiduspider",
  "yandex",
  "sogou",
  "bitlybot",
  "tumblr",
  "vkShare",
  "quora link preview",
  "redditbot",
  "ia_archiver",
  "Bingbot",
  "BingPreview",
  "applebot",
  "facebookexternalhit",
  "facebookcatalog",
  "Twitterbot",
  "LinkedInBot",
  "Slackbot",
  "Discordbot",
  "WhatsApp",
  "SkypeUriPreview",
  "Yeti",
  "googleweblight",
] as const;

const htmlLimitedBots = new RegExp(htmlLimitedBotUserAgents.join("|"), "i");

const nextConfig: NextConfig = {
  basePath,
  htmlLimitedBots,
  serverExternalPackages: ["ydb-sdk", "@yandex-cloud/nodejs-sdk"],
  turbopack: {
    root,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "*.r2.dev",
      },
      {
        protocol: "https",
        hostname: "*.cloudflarestorage.com",
      },
    ],
  },
};

export default nextConfig;
