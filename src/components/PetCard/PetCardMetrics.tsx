"use client";

import { useState, useSyncExternalStore } from "react";
import { useToaster } from "@gravity-ui/uikit";
import {
  ArrowDownToLine,
  FolderArrowDown,
  Heart,
  HeartFill,
} from "@gravity-ui/icons";

import { withBasePath } from "@/lib/base-path";
import { trackGoal } from "@/lib/metrics/yandex";
import type { ApprovalStatus } from "@/lib/pets/types";
import { formatMetricCount, metricLabel } from "@/lib/ui/metrics";

type PetCardMetricsProps = {
  slug: string;
  displayName: string;
  status: ApprovalStatus;
  likeCount: number;
  downloadCount: number;
  installCount: number;
};

type LikeResponse = {
  likeCount?: number;
};

export function PetCardMetrics({
  slug,
  displayName,
  status,
  likeCount,
  downloadCount,
  installCount,
}: PetCardMetricsProps) {
  const { add } = useToaster();
  const [count, setCount] = useState(likeCount);
  const [busy, setBusy] = useState(false);
  const [liked, setLiked] = useState(false);
  const storageKey = `codex-pets-liked:${slug}`;
  const isApproved = status === "approved";
  const storedLiked = useStoredLike(storageKey);
  const isLiked = liked || storedLiked;
  const likeMetricText = `${formatMetricCount(count)} ${metricLabel(count, "like")}`;
  const downloadMetricText = `${formatMetricCount(downloadCount)} ${metricLabel(
    downloadCount,
    "download",
  )}`;

  async function likePet() {
    if (busy || isLiked || !isApproved) return;
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
          name: `pet-card-like-${slug}`,
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
      trackGoal("pet_like", {
        slug,
        surface: "card",
      });
    } finally {
      setBusy(false);
    }
  }

  function trackDownloadClick() {
    trackGoal("pet_download_click", {
      slug,
      surface: "card",
    });
  }

  return (
    <div className="pet-card__metrics" aria-label="Pet metrics">
      {isApproved ? (
        <>
          <button
            type="button"
            onClick={likePet}
            disabled={busy || isLiked}
            className={
              isLiked
                ? "pet-card__metric pet-card__metric-action pet-card__metric-action_liked"
                : "pet-card__metric pet-card__metric-action"
            }
            aria-label={
              isLiked
                ? `Liked ${displayName}: ${likeMetricText}`
                : `Like ${displayName}: ${likeMetricText}`
            }
            title={isLiked ? "Liked" : "Like"}
          >
            {isLiked ? (
              <HeartFill width={16} height={16} />
            ) : (
              <Heart width={16} height={16} />
            )}
            {formatMetricCount(count)} {metricLabel(count, "like")}
          </button>
          <a
            href={withBasePath(`/api/pets/${slug}/download`)}
            className="pet-card__metric pet-card__metric-action"
            aria-label={`Download ZIP for ${displayName}: ${downloadMetricText}`}
            onClick={trackDownloadClick}
            title="Download ZIP"
          >
            <ArrowDownToLine width={16} height={16} />
            {formatMetricCount(downloadCount)}{" "}
            {metricLabel(downloadCount, "download")}
          </a>
        </>
      ) : (
        <>
          <span className="pet-card__metric">
            <Heart width={16} height={16} />
            {formatMetricCount(count)} {metricLabel(count, "like")}
          </span>
          <span className="pet-card__metric">
            <ArrowDownToLine width={16} height={16} />
            {formatMetricCount(downloadCount)}{" "}
            {metricLabel(downloadCount, "download")}
          </span>
        </>
      )}
      <span className="pet-card__metric">
        <FolderArrowDown width={16} height={16} />
        {formatMetricCount(installCount)} {metricLabel(installCount, "install")}
      </span>
    </div>
  );
}

function useStoredLike(storageKey: string): boolean {
  return useSyncExternalStore(
    (onStoreChange) => subscribeToLikedStorage(storageKey, onStoreChange),
    () => readLiked(storageKey),
    () => false,
  );
}

function subscribeToLikedStorage(
  storageKey: string,
  onStoreChange: () => void,
): () => void {
  if (typeof window === "undefined") {
    return () => {};
  }

  const onStorage = (event: StorageEvent) => {
    if (event.key === storageKey) {
      onStoreChange();
    }
  };

  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
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
