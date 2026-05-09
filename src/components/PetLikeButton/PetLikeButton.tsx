"use client";

import { useState } from "react";
import { Button, useToaster } from "@gravity-ui/uikit";
import { Heart, HeartFill } from "@gravity-ui/icons";

import { withBasePath } from "@/lib/base-path";
import { formatMetricCount } from "@/lib/ui/metrics";
import "./PetLikeButton.scss";

type PetLikeButtonProps = {
  slug: string;
  initialLikeCount: number;
};

type LikeResponse = {
  likeCount?: number;
};

export function PetLikeButton({ slug, initialLikeCount }: PetLikeButtonProps) {
  const { add } = useToaster();
  const [count, setCount] = useState(initialLikeCount);
  const [busy, setBusy] = useState(false);
  const [liked, setLiked] = useState(false);
  const storageKey = `codex-pets-liked:${slug}`;
  const label = liked ? "Liked" : "Like";

  async function likePet() {
    if (busy || liked) return;
    if (readLiked(storageKey)) {
      setLiked(true);
      return;
    }

    setBusy(true);
    try {
      const response = await fetch(withBasePath(`/api/pets/${slug}/like`), {
        method: "POST",
      });
      if (!response.ok) {
        add({
          name: `pet-like-${slug}`,
          theme: "danger",
          title: "Like failed",
          content: `Status ${response.status}`,
        });
        return;
      }

      const data = (await response.json()) as LikeResponse;
      const nextCount =
        typeof data.likeCount === "number" ? data.likeCount : count + 1;
      setCount(nextCount);
      setLiked(true);
      saveLiked(storageKey);
    } finally {
      setBusy(false);
    }
  }

  return (
    <Button
      view="outlined"
      size="l"
      onClick={likePet}
      loading={busy}
      disabled={liked}
      className={liked ? "pet-like-button pet-like-button_liked" : "pet-like-button"}
      aria-label={`${formatMetricCount(count)} likes`}
    >
      <Button.Icon>{liked ? <HeartFill /> : <Heart />}</Button.Icon>
      <span className="pet-like-button__label">
        {label}
        <span className="pet-like-button__count">{formatMetricCount(count)}</span>
      </span>
    </Button>
  );
}

function readLiked(storageKey: string): boolean {
  try {
    return window.localStorage.getItem(storageKey) === "1";
  } catch {
    return false;
  }
}

function saveLiked(storageKey: string): void {
  try {
    window.localStorage.setItem(storageKey, "1");
  } catch {
    // Likes are already stored server-side; local storage only prevents repeat clicks.
  }
}
