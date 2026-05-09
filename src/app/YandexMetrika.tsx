"use client";

import Script from "next/script";

import {
  YANDEX_METRIKA_ID,
  getYandexMetrikaInlineScript,
} from "@/lib/metrics/yandex";

const IS_PRODUCTION = process.env.NODE_ENV === "production";

export default function YandexMetrika() {
  if (!IS_PRODUCTION) {
    return null;
  }

  return (
    <>
      <Script id="yandex-metrika" strategy="afterInteractive">
        {getYandexMetrikaInlineScript()}
      </Script>
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
