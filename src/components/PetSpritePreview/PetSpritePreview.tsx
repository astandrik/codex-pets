"use client";

import { useCallback, useState, type ReactNode } from "react";
import { withBasePath } from "@/lib/base-path";
import { getPublicPetPreviewPath } from "@/lib/pets/asset-urls";
import { PET_SHEET, PET_STATES } from "@/lib/pets/types";
import "./PetSpritePreview.scss";

type PetSpritePreviewProps = {
  posterSlug?: string;
  stripSrc: string | null;
  alt: string;
  stripClassName: string;
  eager?: boolean;
  children?: ReactNode;
};

export function PetSpritePreview({
  posterSlug,
  stripSrc,
  alt,
  stripClassName,
  eager = false,
  children,
}: PetSpritePreviewProps) {
  const posterSrc = posterSlug
    ? withBasePath(getPublicPetPreviewPath(posterSlug))
    : null;
  const [loadedStrip, setLoadedStrip] = useState<string | null>(null);
  const [failedPoster, setFailedPoster] = useState<string | null>(null);
  const animated = stripSrc !== null && loadedStrip === stripSrc;
  const checkStrip = useCallback((image: HTMLImageElement | null) => {
    // The server-rendered image may finish loading before hydration.
    if (image?.complete && image.naturalWidth > 0) setLoadedStrip(stripSrc);
  }, [stripSrc]);
  const checkPoster = useCallback((image: HTMLImageElement | null) => {
    if (image?.complete && image.naturalWidth === 0) setFailedPoster(posterSrc);
  }, [posterSrc]);

  return (
    <>
      {!stripSrc && (!posterSrc || failedPoster === posterSrc) ? children : null}
      {posterSrc && failedPoster !== posterSrc ? (
        // Keep the crawlable image in SSR even when API assets are unavailable.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={posterSrc}
          data-pet-poster
          ref={checkPoster}
          src={posterSrc}
          alt={alt}
          width={PET_SHEET.cellWidth}
          height={PET_SHEET.cellHeight}
          className="pet-sprite-preview__poster"
          style={{ visibility: animated ? "hidden" : undefined }}
          loading={eager ? "eager" : "lazy"}
          fetchPriority={eager ? "high" : undefined}
          decoding="async"
          draggable={false}
          onError={() => setFailedPoster(posterSrc)}
        />
      ) : null}
      {stripSrc ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          key={stripSrc}
          ref={checkStrip}
          src={stripSrc}
          alt={posterSrc ? "" : alt}
          width={PET_SHEET.cellWidth * PET_STATES[0].frames}
          height={PET_SHEET.cellHeight}
          className={stripClassName}
          style={{ visibility: posterSrc && !animated ? "hidden" : undefined }}
          loading={eager ? "eager" : "lazy"}
          decoding="async"
          draggable={false}
          onLoad={() => setLoadedStrip(stripSrc)}
          onError={() => setLoadedStrip(null)}
        />
      ) : null}
    </>
  );
}
