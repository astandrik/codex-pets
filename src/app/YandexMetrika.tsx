"use client";

import { usePathname, useSearchParams } from "next/navigation";
import Script from "next/script";
import { Suspense, useEffect, useRef } from "react";

import {
  YANDEX_METRIKA_ID,
  getYandexMetrikaInlineScript,
  trackPageView,
} from "@/lib/metrics/yandex";
import {
  PAGE_VIEW_METADATA_NAME,
  parsePageViewMetadata,
  type PageViewMetadata,
} from "@/lib/metrics/page-view-metadata";
import { withBasePath } from "@/lib/base-path";

const IS_PRODUCTION = process.env.NODE_ENV === "production";
const PAGE_TITLE_SETTLE_DELAY_MS = 250;
const PAGE_TITLE_WAIT_TIMEOUT_MS = 5_000;
const GALLERY_CONTENT_SEARCH_PARAMS = ["q", "tags", "kind"] as const;

type PageViewState = {
  runtime?: PageViewRuntime;
  title: string;
  url: string | null;
  usesPageViewMetadata?: boolean;
};

type PendingPageView = {
  candidateTitle: string | null;
  fallbackTimeoutId: ReturnType<typeof setTimeout> | null;
  readyTitle: string | null;
  referer: string;
  settleTimeoutId: ReturnType<typeof setTimeout> | null;
  url: string;
};

type PageViewRuntime = {
  observer: MutationObserver | null;
  pendingPageViews: PendingPageView[];
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
  const baseUrl = window.location.origin;
  const previous = new URL(previousUrl, baseUrl);
  const current = new URL(currentUrl, baseUrl);

  return (
    previous.pathname === current.pathname &&
    previous.searchParams.toString() === current.searchParams.toString()
  );
}

function hasMatchingPageViewMetadata(
  pageViewUrl: string,
  metadataUrl: string,
): boolean {
  const baseUrl = window.location.origin;
  const pageView = new URL(pageViewUrl, baseUrl);
  const metadata = new URL(metadataUrl, baseUrl);
  const galleryPathname = withBasePath("/");
  const isGalleryPage =
    pageView.pathname === galleryPathname ||
    (galleryPathname !== "/" &&
      pageView.pathname === `${galleryPathname}/`);
  const hasContentSearchParam =
    isGalleryPage &&
    GALLERY_CONTENT_SEARCH_PARAMS.some((key) =>
      pageView.searchParams.has(key),
    );

  return (
    pageView.pathname === metadata.pathname &&
    ((!hasContentSearchParam && metadata.search === "") ||
      pageView.searchParams.toString() === metadata.searchParams.toString())
  );
}

type PageViewMetadataElement = HTMLMetaElement;

function asPageViewMetadataElement(
  value: unknown,
): PageViewMetadataElement | null {
  if (
    typeof value !== "object" ||
    value === null ||
    !("tagName" in value) ||
    value.tagName !== "META" ||
    !("getAttribute" in value) ||
    typeof value.getAttribute !== "function" ||
    value.getAttribute("name") !== PAGE_VIEW_METADATA_NAME
  ) {
    return null;
  }

  return value as PageViewMetadataElement;
}

function getCurrentPageViewMetadata(): PageViewMetadata | null {
  if (typeof document.querySelector !== "function") {
    return null;
  }

  const element = document.querySelector(
    `meta[name="${PAGE_VIEW_METADATA_NAME}"]`,
  );
  return parsePageViewMetadata(element?.getAttribute("content") ?? null);
}

function getNextMetadataContent(
  records: MutationRecord[],
  recordIndex: number,
  target: PageViewMetadataElement,
): string | null {
  for (let index = recordIndex + 1; index < records.length; index += 1) {
    const nextRecord = records[index];
    if (
      nextRecord.type === "attributes" &&
      nextRecord.attributeName === "content" &&
      nextRecord.target === target
    ) {
      return nextRecord.oldValue;
    }
  }

  return target.getAttribute("content");
}

function getFirstMetadataAttributeOldValue(
  records: MutationRecord[],
  recordIndex: number,
  target: PageViewMetadataElement,
): string | null | undefined {
  for (let index = recordIndex + 1; index < records.length; index += 1) {
    const nextRecord = records[index];
    if (
      nextRecord.type === "attributes" &&
      nextRecord.attributeName === "content" &&
      nextRecord.target === target
    ) {
      return nextRecord.oldValue;
    }
  }

  return undefined;
}

function getAddedPageViewMetadataElements(
  record: MutationRecord,
): PageViewMetadataElement[] {
  const elements: PageViewMetadataElement[] = [];
  for (const node of Array.from(record.addedNodes ?? [])) {
    const element = asPageViewMetadataElement(node);
    if (element) {
      elements.push(element);
    }

    if (
      typeof node === "object" &&
      node !== null &&
      "querySelectorAll" in node &&
      typeof node.querySelectorAll === "function"
    ) {
      const descendants = node.querySelectorAll(
        `meta[name="${PAGE_VIEW_METADATA_NAME}"]`,
      );
      for (const descendant of Array.from(descendants)) {
        const descendantElement = asPageViewMetadataElement(descendant);
        if (descendantElement) {
          elements.push(descendantElement);
        }
      }
    }
  }

  return elements;
}

function getObservedPageViewMetadata(
  records: MutationRecord[],
): PageViewMetadata[] {
  const metadata: PageViewMetadata[] = [];
  let previousContent: string | null = null;

  function append(content: string | null) {
    if (!content || content === previousContent) {
      return;
    }
    previousContent = content;
    const parsed = parsePageViewMetadata(content);
    if (parsed) {
      metadata.push(parsed);
    }
  }

  for (let index = 0; index < records.length; index += 1) {
    const record = records[index];
    if (record.type === "childList") {
      for (const element of getAddedPageViewMetadataElements(record)) {
        const initialContent = getFirstMetadataAttributeOldValue(
          records,
          index,
          element,
        );
        append(
          initialContent === undefined
            ? element.getAttribute("content")
            : initialContent,
        );
      }
      continue;
    }

    const target = asPageViewMetadataElement(record.target);
    if (
      record.type === "attributes" &&
      record.attributeName === "content" &&
      target
    ) {
      append(getNextMetadataContent(records, index, target));
    }
  }

  return metadata;
}

function getPageViewRuntime(pageViewState: PageViewState): PageViewRuntime {
  pageViewState.runtime ??= {
    observer: null,
    pendingPageViews: [],
  };
  return pageViewState.runtime;
}

function clearPageViewTimeouts(pageView: PendingPageView) {
  if (pageView.settleTimeoutId !== null) {
    clearTimeout(pageView.settleTimeoutId);
    pageView.settleTimeoutId = null;
  }
  if (pageView.fallbackTimeoutId !== null) {
    clearTimeout(pageView.fallbackTimeoutId);
    pageView.fallbackTimeoutId = null;
  }
}

function stopIdlePageViewObserver(pageViewState: PageViewState) {
  const runtime = pageViewState.runtime;
  if (!runtime || runtime.pendingPageViews.length > 0) {
    return;
  }

  runtime.observer?.disconnect();
  runtime.observer = null;
}

function drainReadyPageViews(pageViewState: PageViewState) {
  const runtime = getPageViewRuntime(pageViewState);
  let pageView = runtime.pendingPageViews[0];

  while (pageView && pageView.readyTitle !== null) {
    runtime.pendingPageViews.shift();
    clearPageViewTimeouts(pageView);
    pageViewState.title = pageView.readyTitle;
    trackPageView(pageView.url, {
      referer: pageView.referer,
      title: pageView.readyTitle,
    });
    pageView = runtime.pendingPageViews[0];
  }

  stopIdlePageViewObserver(pageViewState);
}

function getPreviousPendingTitle(
  pageViewState: PageViewState,
  pageView: PendingPageView,
): string {
  const pendingPageViews = getPageViewRuntime(pageViewState).pendingPageViews;
  const pageViewIndex = pendingPageViews.indexOf(pageView);

  for (let index = pageViewIndex - 1; index >= 0; index -= 1) {
    const previousPageView = pendingPageViews[index];
    const previousTitle =
      previousPageView.readyTitle ?? previousPageView.candidateTitle;
    if (previousTitle) {
      return previousTitle;
    }
  }

  return pageViewState.title || document.title;
}

function markPageViewReady(
  pageViewState: PageViewState,
  pageView: PendingPageView,
  title: string,
) {
  if (pageView.readyTitle !== null) {
    return;
  }

  if (pageView.settleTimeoutId !== null) {
    clearTimeout(pageView.settleTimeoutId);
    pageView.settleTimeoutId = null;
  }
  pageView.candidateTitle = null;
  pageView.readyTitle = title;
  drainReadyPageViews(pageViewState);
}

function schedulePageViewTitle(
  pageViewState: PageViewState,
  pageView: PendingPageView,
  title: string,
) {
  if (pageView.readyTitle !== null) {
    return;
  }

  pageView.candidateTitle = title;
  if (pageView.settleTimeoutId !== null) {
    clearTimeout(pageView.settleTimeoutId);
  }
  pageView.settleTimeoutId = setTimeout(() => {
    pageView.settleTimeoutId = null;
    const candidateTitle = pageView.candidateTitle;
    if (candidateTitle) {
      markPageViewReady(pageViewState, pageView, candidateTitle);
    }
  }, PAGE_TITLE_SETTLE_DELAY_MS);
}

function capturePageViewMetadata(
  pageViewState: PageViewState,
  metadata: PageViewMetadata,
) {
  const pageView = pageViewState.runtime?.pendingPageViews.find(
    (candidate) =>
      candidate.readyTitle === null &&
      hasMatchingPageViewMetadata(candidate.url, metadata.url),
  );
  if (pageView) {
    markPageViewReady(pageViewState, pageView, metadata.title);
  }
}

function captureObservedPageViewMetadata(
  pageViewState: PageViewState,
  records: MutationRecord[],
) {
  for (const metadata of getObservedPageViewMetadata(records)) {
    capturePageViewMetadata(pageViewState, metadata);
  }
}

function captureCurrentPageViewMetadata(pageViewState: PageViewState) {
  const metadata = getCurrentPageViewMetadata();
  if (metadata) {
    capturePageViewMetadata(pageViewState, metadata);
  }
}

function captureQueuedPageViewMetadata(pageViewState: PageViewState) {
  const records = pageViewState.runtime?.observer?.takeRecords() ?? [];
  captureObservedPageViewMetadata(pageViewState, records);
}

function captureObservedTitle(pageViewState: PageViewState) {
  const runtime = pageViewState.runtime;
  const title = document.title;
  if (!runtime || runtime.pendingPageViews.length === 0 || !title) {
    return;
  }

  const matchingPageView = runtime.pendingPageViews.find(
    (pageView) =>
      pageView.readyTitle === null && pageView.candidateTitle === title,
  );
  if (matchingPageView) {
    schedulePageViewTitle(pageViewState, matchingPageView, title);
    return;
  }

  // Next can advance the URL before an earlier head mutation is delivered.
  // Preserve navigation order by assigning each new title to the oldest wait.
  const unresolvedPageView = runtime.pendingPageViews.find(
    (pageView) =>
      pageView.readyTitle === null && pageView.candidateTitle === null,
  );
  if (unresolvedPageView) {
    const previousTitle = getPreviousPendingTitle(
      pageViewState,
      unresolvedPageView,
    );
    if (title !== previousTitle) {
      schedulePageViewTitle(pageViewState, unresolvedPageView, title);
    }
    return;
  }

  let currentPageView: PendingPageView | undefined;
  for (
    let index = runtime.pendingPageViews.length - 1;
    index >= 0;
    index -= 1
  ) {
    const pageView = runtime.pendingPageViews[index];
    if (
      pageView.readyTitle === null &&
      pageView.url === window.location.href
    ) {
      currentPageView = pageView;
      break;
    }
  }
  if (currentPageView) {
    schedulePageViewTitle(pageViewState, currentPageView, title);
  }
}

function ensurePageViewObserver(pageViewState: PageViewState) {
  const runtime = getPageViewRuntime(pageViewState);
  if (runtime.observer !== null) {
    return;
  }

  runtime.observer = new MutationObserver((records) => {
    if (pageViewState.usesPageViewMetadata) {
      captureObservedPageViewMetadata(pageViewState, records);
      captureCurrentPageViewMetadata(pageViewState);
      return;
    }

    captureObservedTitle(pageViewState);
  });
  runtime.observer.observe(document.head, {
    attributeFilter: ["content"],
    attributeOldValue: true,
    attributes: true,
    characterData: true,
    childList: true,
    subtree: true,
  });
}

function queuePageView(
  pageViewState: PageViewState,
  transition: { referer: string; url: string },
) {
  const runtime = getPageViewRuntime(pageViewState);
  const pageView: PendingPageView = {
    candidateTitle: null,
    fallbackTimeoutId: null,
    readyTitle: null,
    referer: transition.referer,
    settleTimeoutId: null,
    url: transition.url,
  };
  runtime.pendingPageViews.push(pageView);
  ensurePageViewObserver(pageViewState);

  pageView.fallbackTimeoutId = setTimeout(() => {
    const fallbackTitle =
      pageView.candidateTitle ??
      getPreviousPendingTitle(pageViewState, pageView);
    markPageViewReady(pageViewState, pageView, fallbackTitle);
  }, PAGE_TITLE_WAIT_TIMEOUT_MS);

  return pageView;
}

function finishSupersededCandidate(
  pageViewState: PageViewState,
  previousUrl: string,
) {
  const pendingPageViews =
    pageViewState.runtime?.pendingPageViews ?? [];
  let pageView: PendingPageView | undefined;
  for (let index = pendingPageViews.length - 1; index >= 0; index -= 1) {
    const candidate = pendingPageViews[index];
    if (candidate.url === previousUrl) {
      pageView = candidate;
      break;
    }
  }
  if (pageView?.candidateTitle) {
    markPageViewReady(pageViewState, pageView, pageView.candidateTitle);
  }
}

function disposePageViewState(pageViewState: PageViewState) {
  const runtime = pageViewState.runtime;
  if (!runtime) {
    return;
  }

  runtime.observer?.disconnect();
  for (const pageView of runtime.pendingPageViews) {
    clearPageViewTimeouts(pageView);
  }
  pageViewState.runtime = undefined;
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
    const currentPageViewMetadata = getCurrentPageViewMetadata();
    pageViewState.usesPageViewMetadata ??=
      currentPageViewMetadata !== null;
    const previousUrl = pageViewState.url;
    const transition = getPageViewTransition(previousUrl, currentUrl);

    if (previousUrl === null) {
      pageViewState.url = currentUrl;
      pageViewState.title =
        currentPageViewMetadata?.title ?? document.title;
      return;
    }

    if (transition === null) {
      return;
    }

    if (pageViewState.usesPageViewMetadata) {
      captureQueuedPageViewMetadata(pageViewState);
      pageViewState.url = currentUrl;
      const pageView = queuePageView(pageViewState, transition);
      if (currentPageViewMetadata) {
        capturePageViewMetadata(pageViewState, currentPageViewMetadata);
      } else {
        captureCurrentPageViewMetadata(pageViewState);
      }

      if (
        pageView.readyTitle === null &&
        document.title &&
        hasEquivalentPageContent(previousUrl, currentUrl)
      ) {
        markPageViewReady(pageViewState, pageView, document.title);
      }
      return;
    }

    captureObservedTitle(pageViewState);
    finishSupersededCandidate(pageViewState, previousUrl);
    pageViewState.url = currentUrl;

    const currentTitle = document.title;
    if (
      currentTitle &&
      hasEquivalentPageContent(previousUrl, currentUrl)
    ) {
      const pageView = queuePageView(pageViewState, transition);
      markPageViewReady(pageViewState, pageView, currentTitle);
      return;
    }

    queuePageView(pageViewState, transition);
    captureObservedTitle(pageViewState);
  }, [pathname, searchParams]);

  useEffect(
    () => () => {
      disposePageViewState(pageViewStateRef.current);
    },
    [],
  );

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
