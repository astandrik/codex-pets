import type { Metadata, Viewport } from "next";
import { getRootClassName } from "@gravity-ui/uikit/server";
import "@gravity-ui/uikit/styles/fonts.css";
import "@gravity-ui/uikit/styles/styles.css";
import "@/styles/globals.scss";

import { AppHeader } from "@/components/AppHeader/AppHeader";
import { Footer } from "@/components/Footer/Footer";
import { Providers } from "@/app/Providers";
import YandexMetrika from "@/app/YandexMetrika";
import { withBasePath } from "@/lib/base-path";

const THEME = "dark" as const;

export const viewport: Viewport = {
  themeColor: "#151617",
};

export const metadata: Metadata = {
  title: "Codex Pets",
  description:
    "Community gallery for Codex-compatible animated pets. Browse, preview, upload, and download pet packs.",
  metadataBase: new URL(
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000",
  ),
  robots: {
    index: true,
    follow: true,
  },
  icons: {
    icon: withBasePath("/favicon.svg"),
  },
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const rootClassName = getRootClassName({ theme: THEME });

  return (
    <html lang="en">
      <body className={rootClassName}>
        <Providers>
          <AppHeader />
          {children}
          <Footer />
        </Providers>
        <YandexMetrika />
      </body>
    </html>
  );
}
