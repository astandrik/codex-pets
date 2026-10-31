"use client";

import Image from "next/image";
import {useEffect, useState, type CSSProperties} from "react";
import {Button} from "@/components/GravityUI/GravityUI";
import {getPetIdleStripUrl} from "@/lib/pets/asset-urls";
import {PET_SHEET, PET_STATES, type PublicPetSummary} from "@/lib/pets/types";
import {withBasePath} from "@/lib/base-path";
import "./HomeGeneratedPetExample.scss";

export function HomeGeneratedPetExample({pet}: {pet: PublicPetSummary | null}) {
  const [playing, setPlaying] = useState(false);
  const [visible, setVisible] = useState(true);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);

  useEffect(() => {
    const update = () => setVisible(document.visibilityState !== "hidden");
    update();
    document.addEventListener("visibilitychange", update);
    return () => document.removeEventListener("visibilitychange", update);
  }, []);

  if (!pet) {
    return <div className="home-example home-example_empty">
      <p>Discover a pet in the community gallery.</p>
      <a href={withBasePath("/#gallery")}>Explore the gallery →</a>
    </div>;
  }

  const url = getPetIdleStripUrl(pet.spritesheetUrl);
  const imageFailed = failedUrl === url;
  const style = {
    "--example-frames": PET_STATES[0].frames,
    "--example-duration": `${PET_STATES[0].frames * 140}ms`,
    animationPlayState: playing && visible ? "running" : "paused",
  } as CSSProperties;

  return <aside className="home-example" aria-label="Generated pet example">
    <p className="home-example__label">Made with Codex Pets</p>
    <div className="home-example__stage">
      {url && !imageFailed ? (
        <div className="home-example__viewport">
          <Image className="home-example__strip" src={url}
            alt={`${pet.displayName} — animated example`}
            width={PET_SHEET.cellWidth * PET_STATES[0].frames} height={PET_SHEET.cellHeight}
            style={style} unoptimized priority onError={() => setFailedUrl(url)}/>
        </div>
      ) : <p>Preview unavailable</p>}
    </div>
    <div className="home-example__heading">
      <h2>{pet.displayName}</h2>
      <Button type="button" view="outlined" size="l" disabled={!url || imageFailed}
        aria-pressed={playing} onClick={() => setPlaying(value => !value)}>
        {playing ? "Pause example" : "Play example"}
      </Button>
    </div>
    <p>A real generated pet from the public gallery.</p>
    <a href={withBasePath(`/pets/${pet.slug}`)}>View this pet ↗</a>
  </aside>;
}
