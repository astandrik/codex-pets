import type { Metadata, Viewport } from "next";
import { getRootClassName } from "@gravity-ui/uikit/server";
import "@gravity-ui/uikit/styles/fonts.css";
import "@gravity-ui/uikit/styles/styles.css";
import "@/styles/globals.scss";

import { AppHeader } from "@/components/AppHeader/AppHeader";
import { Footer } from "@/components/Footer/Footer";
import { WebMCPRegistrar } from "@/components/WebMCP/WebMCPRegistrar";
import { Providers } from "@/app/Providers";
import YandexMetrika from "@/app/YandexMetrika";
import { getPublicOrigin, toPublicUrl, withBasePath } from "@/lib/base-path";
import {
  getAgentResourceAlternateTypes,
  getSiteSocialImagePath,
  getWebsiteJsonLd,
  SITE_DESCRIPTION,
  SITE_IMAGE_ALT,
  SITE_KEYWORDS,
  SITE_NAME,
  SITE_TITLE,
} from "@/lib/site-metadata";

const THEME = "dark" as const;

export const viewport: Viewport = {
  themeColor: "#151617",
};

export const metadata: Metadata = {
  applicationName: SITE_NAME,
  title: {
    default: SITE_TITLE,
    template: `%s - ${SITE_NAME}`,
  },
  description: SITE_DESCRIPTION,
  keywords: SITE_KEYWORDS,
  metadataBase: new URL(getPublicOrigin()),
  alternates: {
    canonical: withBasePath("/"),
    types: getAgentResourceAlternateTypes(),
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-image-preview": "large",
      "max-snippet": -1,
      "max-video-preview": -1,
    },
  },
  icons: {
    icon: withBasePath("/favicon.svg"),
  },
  openGraph: {
    type: "website",
    locale: "en_US",
    siteName: SITE_NAME,
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    url: withBasePath("/"),
    images: [
      {
        url: toPublicUrl(getSiteSocialImagePath()),
        secureUrl: toPublicUrl(getSiteSocialImagePath()),
        width: 1200,
        height: 630,
        alt: SITE_IMAGE_ALT,
        type: "image/png",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE_DESCRIPTION,
    images: [
      {
        url: toPublicUrl(getSiteSocialImagePath()),
        secureUrl: toPublicUrl(getSiteSocialImagePath()),
        alt: SITE_IMAGE_ALT,
        type: "image/png",
        width: 1200,
        height: 630,
      },
    ],
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const rootClassName = getRootClassName({ theme: THEME });
  const websiteJsonLd = getWebsiteJsonLd();

  return (
    <html lang="en">
      <body className={rootClassName}>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(websiteJsonLd) }}
        />
        <Providers>
          <WebMCPRegistrar />
          <AppHeader />
          {children}
          <Footer />
        </Providers>
        <YandexMetrika />
      </body>
    </html>
  );
}
