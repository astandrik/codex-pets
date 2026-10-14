import { withBasePath } from "@/lib/base-path";

export const YANDEX_METRIKA_ID = 104844437;

export const YANDEX_METRIKA_OPTIONS = { defer: true, clickmap: true, trackLinks: true, accurateTrackBounce: true, webvisor: true };
export function isGeneratedPreviewUrl(value: string) {
  try { const pathname = new URL(value, "https://local.invalid").pathname; return pathname === withBasePath("/admin/generation-limits") || pathname === withBasePath("/generate") || pathname === withBasePath("/my-generations") || pathname.startsWith(withBasePath("/generated/")); } catch { return false; }
}
let generationPrivacyStopped = false;
export function setGenerationAnalyticsPrivacy(privatePage: boolean) {
  if (typeof window === "undefined" || typeof window.ym !== "function") return;
  if (privatePage) {
    window.ym(YANDEX_METRIKA_ID, "destruct");
    generationPrivacyStopped = true;
  } else if (generationPrivacyStopped) {
    generationPrivacyStopped = false;
    window.ym(YANDEX_METRIKA_ID, "init", YANDEX_METRIKA_OPTIONS);
    trackPageView(window.location.href, { title: document.title, referer: "" });
  }
}

export type YandexGoalParams = Record<string, unknown>;
export type YandexPageViewOptions = {
  referer?: string;
  title?: string;
};

declare global {
  interface Window {
    ym?: {
      (counterId: number, event: "destruct"): void;
      (counterId: number, event: "init", options: typeof YANDEX_METRIKA_OPTIONS): void;
      (
        counterId: number,
        event: "reachGoal",
        goal: string,
        params?: YandexGoalParams,
      ): void;
      (
        counterId: number,
        event: "hit",
        url: string,
        options: YandexPageViewOptions,
      ): void;
    };
  }
}

export function getYandexMetrikaInlineScript(): string {
  return `
    (function() {
      if ((window.location.pathname === ${JSON.stringify(withBasePath("/admin/generation-limits"))} || window.location.pathname === ${JSON.stringify(withBasePath("/generate"))} || window.location.pathname === ${JSON.stringify(withBasePath("/my-generations"))} || window.location.pathname.startsWith(${JSON.stringify(withBasePath("/generated/"))}))) return;
      (function(m,e,t,r,i,k,a){m[i]=m[i]||function(){(m[i].a=m[i].a||[]).push(arguments)};
      m[i].l=1*new Date();
      for (var j = 0; j < document.scripts.length; j++) {if (document.scripts[j].src === r) { return; }}
      k=e.createElement(t),a=e.getElementsByTagName(t)[0],k.async=1,k.src=r,a.parentNode.insertBefore(k,a)})
      (window, document, "script", "https://mc.yandex.ru/metrika/tag.js", "ym");
      ym(${YANDEX_METRIKA_ID}, "init", ${JSON.stringify(YANDEX_METRIKA_OPTIONS)});
      (function() {
        function sendInitialHit() {
          if ((window.location.pathname === ${JSON.stringify(withBasePath("/admin/generation-limits"))} || window.location.pathname === ${JSON.stringify(withBasePath("/generate"))} || window.location.pathname === ${JSON.stringify(withBasePath("/my-generations"))} || window.location.pathname.startsWith(${JSON.stringify(withBasePath("/generated/"))}))) return;
          ym(${YANDEX_METRIKA_ID}, "hit", window.location.href, {
               referer:document.referrer.includes(${JSON.stringify(withBasePath("/generated/"))}) ? "" : document.referrer,
               title:document.title
          });
        }

        if (document.readyState === "loading") {
          document.addEventListener("DOMContentLoaded", sendInitialHit, { once: true });
        } else {
          sendInitialHit();
        }
      })();
    })();
    `;
}

export function trackGoal(goal: string, params?: YandexGoalParams): void {
  if (typeof window === "undefined" || typeof window.ym !== "function" || isGeneratedPreviewUrl(window.location.href)) {
    return;
  }

  try {
    window.ym(YANDEX_METRIKA_ID, "reachGoal", goal, params);
  } catch {
    // ignore metrics failures
  }
}

export function trackPageView(
  url: string,
  options: YandexPageViewOptions,
): void {
  if (typeof window === "undefined" || typeof window.ym !== "function" || isGeneratedPreviewUrl(window.location.href)) {
    return;
  }

  try {
    if (isGeneratedPreviewUrl(url)) return;
    window.ym(YANDEX_METRIKA_ID, "hit", url, { ...options, referer: options.referer && isGeneratedPreviewUrl(options.referer) ? "" : options.referer });
  } catch {
    // ignore metrics failures
  }
}
