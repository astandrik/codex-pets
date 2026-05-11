import { ImageResponse } from "next/og";

import {
  SITE_DESCRIPTION,
  SITE_IMAGE_ALT,
  SITE_NAME,
  SITE_TAGLINE,
  SOCIAL_IMAGE,
} from "@/lib/site-metadata";

export const siteOgAlt = SITE_IMAGE_ALT;
export const siteOgSize = {
  width: SOCIAL_IMAGE.width,
  height: SOCIAL_IMAGE.height,
};

export function renderSiteOgImage(): ImageResponse {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          position: "relative",
          overflow: "hidden",
          background: "#111418",
          color: "#f8fafc",
          fontFamily:
            'Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
        }}
      >
        <div
          style={{
            position: "absolute",
            inset: 0,
            background:
              "linear-gradient(135deg, #111418 0%, #1b2430 46%, #16241d 100%)",
          }}
        />
        <div
          style={{
            position: "absolute",
            right: 80,
            top: 70,
            width: 340,
            height: 340,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            transform: "rotate(3deg)",
          }}
        >
          <div
            style={{
              position: "absolute",
              width: 340,
              height: 340,
              borderRadius: 48,
              background: "#ffbd4a",
              boxShadow: "0 32px 80px rgba(0, 0, 0, 0.35)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 34,
              top: -18,
              width: 82,
              height: 112,
              borderRadius: 18,
              background: "#ffbd4a",
              transform: "rotate(-16deg)",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 34,
              top: -18,
              width: 82,
              height: 112,
              borderRadius: 18,
              background: "#ffbd4a",
              transform: "rotate(16deg)",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 86,
              top: 138,
              width: 42,
              height: 64,
              borderRadius: 12,
              background: "#070a11",
            }}
          />
          <div
            style={{
              position: "absolute",
              right: 86,
              top: 138,
              width: 42,
              height: 64,
              borderRadius: 12,
              background: "#070a11",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 158,
              top: 232,
              width: 26,
              height: 26,
              borderRadius: 6,
              background: "#070a11",
            }}
          />
          <div
            style={{
              position: "absolute",
              left: 38,
              bottom: 0,
              width: 264,
              height: 76,
              borderRadius: 28,
              background: "#efa832",
            }}
          />
        </div>
        <div
          style={{
            position: "relative",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            width: 700,
            paddingLeft: 84,
            gap: 28,
          }}
        >
          <div
            style={{
              display: "flex",
              width: 388,
              padding: "12px 18px",
              borderRadius: 999,
              background: "rgba(255, 189, 74, 0.14)",
              color: "#ffcf75",
              fontSize: 30,
              fontWeight: 700,
            }}
          >
            The Codex pet registry
          </div>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 12,
            }}
          >
            <div
              style={{
                fontSize: 92,
                lineHeight: 0.95,
                fontWeight: 800,
                letterSpacing: 0,
              }}
            >
              {SITE_NAME}
            </div>
            <div
              style={{
                color: "#ffbd4a",
                fontSize: 48,
                lineHeight: 1.1,
                fontWeight: 700,
                letterSpacing: 0,
              }}
            >
              {SITE_TAGLINE}
            </div>
          </div>
          <div
            style={{
              color: "#cad2dd",
              fontSize: 32,
              lineHeight: 1.35,
              width: 660,
            }}
          >
            {SITE_DESCRIPTION}
          </div>
        </div>
      </div>
    ),
    siteOgSize,
  );
}
