"use client";

import {useState} from "react";
import Image from "next/image";
import {Picture} from "@gravity-ui/icons";
import {Icon} from "@gravity-ui/uikit";
import {withBasePath} from "@/lib/base-path";
import type {HistoryGeneration} from "@/lib/pets/generation/history";
import {getPetSheet, inferSpriteVersionNumber} from "@/lib/pets/types";

export function GenerationThumbnail({generationId, generation, expired}: {
  generationId: string;
  generation?: HistoryGeneration;
  expired: boolean;
}) {
  const atlas = !generation?.baseUrl && generation?.status === "completed";
  // Server URLs signal availability; build the private URL from the validated history ID.
  let url: string | undefined;
  if (!expired) {
    if (generation?.baseUrl) url = withBasePath(`/api/pet-generations/${generationId}/base`);
    else if (atlas) url = withBasePath(`/api/pet-generations/${generationId}/files/spritesheet.webp`);
  }
  return <div className="my-generations__thumbnail" aria-hidden="true">
    {url ? <ThumbnailImage key={url} url={url} atlas={atlas}/> : <Icon data={Picture} size={24}/>}
  </div>;
}

function ThumbnailImage({url, atlas}: {url: string; atlas: boolean}) {
  const [status, setStatus] = useState<"loading" | "ready" | "failed">("loading");
  if (status === "failed") return <Icon data={Picture} size={24}/>;
  const sheet = getPetSheet(2);
  const image = <Image
    src={url}
    alt=""
    width={atlas ? sheet.width : 64}
    height={atlas ? sheet.height : 64}
    className={`${atlas ? "my-generations__thumbnail-atlas" : "my-generations__thumbnail-image"}${status === "loading" ? " my-generations__thumbnail-image_loading" : ""}`}
    loading="lazy"
    decoding="async"
    referrerPolicy="no-referrer"
    draggable={false}
    unoptimized
    onLoad={event => {
      const {naturalWidth, naturalHeight} = event.currentTarget;
      setStatus(atlas && !inferSpriteVersionNumber(naturalWidth, naturalHeight) ? "failed" : "ready");
    }}
    onError={() => setStatus("failed")}
  />;
  return <>
    {status === "loading" && <Icon data={Picture} size={24}/>}
    {atlas ? <span className="my-generations__thumbnail-frame">{image}</span> : image}
  </>;
}
