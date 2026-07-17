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
const PAGE_TITLE_WAIT_TIMEOUT_MS = 5_000;

type PageViewState = {
  title: string;
  url: string | null;
};

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

function hasEquivalentPageContent(
  previousUrl: string,
  currentUrl: string,
): boolean {
  const previous = new URL(previousUrl);
  const current = new URL(currentUrl);

  return (
    previous.pathname === current.pathname &&
    previous.searchParams.toString() === current.searchParams.toString()
  );
}

function waitForPageTitle(
  previousTitle: string,
  onReady: (title: string) => void,
): () => void {
  let observer: MutationObserver | null = null;
  let timeoutId: ReturnType<typeof setTimeout> | null = null;
  let settled = false;

  function cleanup() {
    observer?.disconnect();
    if (timeoutId !== null) {
      clearTimeout(timeoutId);
    }
  }

  function deliverChangedTitle(): boolean {
    const title = document.title;
    if (settled || !title || title === previousTitle) {
      return false;
    }

    settled = true;
    cleanup();
    onReady(title);
    return true;
  }

  observer = new MutationObserver(() => {
    deliverChangedTitle();
  });
  observer.observe(document.head, {
    characterData: true,
    childList: true,
    subtree: true,
  });

  if (!deliverChangedTitle()) {
    timeoutId = setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      cleanup();
      onReady(document.title);
    }, PAGE_TITLE_WAIT_TIMEOUT_MS);
  }

  return () => {
    settled = true;
    cleanup();
  };
}

function YandexMetrikaRouteTracker() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const pageViewStateRef = useRef<PageViewState>({
    title: "",
    url: null,
  });

  useEffect(() => {
    const currentUrl = window.location.href;
    const pageViewState = pageViewStateRef.current;
    const previousUrl = pageViewState.url;
    const transition = getPageViewTransition(previousUrl, currentUrl);
    pageViewState.url = currentUrl;

    if (previousUrl === null) {
      pageViewState.title = document.title;
      return;
    }

    if (transition === null) {
      return;
    }

    const { referer, url } = transition;

    function sendPageView(title: string) {
      pageViewState.title = title;
      trackPageView(url, {
        referer,
        title,
      });
    }

    const currentTitle = document.title;
    if (
      currentTitle &&
      (currentTitle !== pageViewState.title ||
        hasEquivalentPageContent(previousUrl, currentUrl))
    ) {
      sendPageView(currentTitle);
      return;
    }

    return waitForPageTitle(pageViewState.title, sendPageView);
  }, [pathname, searchParams]);

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
