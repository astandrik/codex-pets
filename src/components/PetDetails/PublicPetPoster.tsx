"use client";

import { useCallback, useState } from "react";
import { withBasePath } from "@/lib/base-path";
import { getPublicPetPreviewPath } from "@/lib/pets/asset-urls";
import "./PublicPetPoster.scss";

export function PublicPetPoster({ slug, displayName, description }: {
  slug: string;
  displayName: string;
  description: string;
}) {
  const src = withBasePath(getPublicPetPreviewPath(slug));
  const [failedSource, setFailedSource] = useState<string | null>(null);
  const checkLoadedImage = useCallback((image: HTMLImageElement | null) => {
    // Native image errors can happen before React attaches its event handler.
    if (image?.complete && image.naturalWidth === 0) setFailedSource(src);
  }, [src]);

  return (
    <div className="public-pet-poster">
      {failedSource === src ? (
        <span role="status">Preview unavailable</span>
      ) : (
        // A direct image request rechecks publication status, including on revalidation.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          data-pet-poster
          ref={checkLoadedImage}
          src={src}
          alt={`${displayName}: ${description}`}
          width={192}
          height={208}
          onError={() => setFailedSource(src)}
        />
      )}
    </div>
  );
}
