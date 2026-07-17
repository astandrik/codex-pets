"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Script from "next/script";
import { Suspense, useEffect, useRef } from "react";

import {
  YANDEX_METRIKA_ID,
  getYandexMetrikaInlineScript,
  trackPageView,
} from "@/lib/metrics/yandex";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export function getPageViewTransition(
  previousUrl: string | null,
  currentUrl: string,
): { referer: string; url: string } | null {
  if (previousUrl === null || previousUrl === currentUrl) {
    return null;
  }

  return {
    referer: previousUrl,
    url: currentUrl,
  };
}

function YandexMetrikaRouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const previousUrlRef = useRef<string | null>(null);
  const queryString = searchParams.toString();
  const routeUrl = queryString ? `${pathname}?${queryString}` : pathname;

  useEffect(() => {
    const currentUrl = new URL(routeUrl, window.location.origin).href;
    const transition = getPageViewTransition(
      previousUrlRef.current,
      currentUrl,
    );
    previousUrlRef.current = currentUrl;

    if (transition === null) {
      return;
    }

    trackPageView(transition.url, {
      referer: transition.referer,
      title: document.title,
    });
  }, [routeUrl]);

  return null;
}

export default function YandexMetrika() {
  if (!IS_PRODUCTION) {
    return null;
  }

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">
        {getYandexMetrikaInlineScript()}
      </Script>
      <Suspense fallback={null}>
        <YandexMetrikaRouteTracker />
      </Suspense>
      <noscript>
        <div>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://mc.yandex.ru/watch/${YANDEX_METRIKA_ID}`}
            style={{ position: "absolute", left: "-9999px" }}
            alt=""
          />
        </div>
      </noscript>
    </>
  );
}
