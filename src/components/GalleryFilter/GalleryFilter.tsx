"use client";

import {
  FormEvent,
  useEffect,
  useRef,
  useState,
  useTransition,
} from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Flex,
  Select,
  Spin,
  TextInput,
} from "@gravity-ui/uikit";
import { Magnifier, Xmark } from "@gravity-ui/icons";

import {
  buildGalleryHref,
  hasGalleryFilters,
  normalizeGalleryTags,
  parseGalleryKind,
} from "@/lib/pets/gallery-filters";
import { trackGoal } from "@/lib/metrics/yandex";
import type { PetKind } from "@/lib/pets/types";
import "./GalleryFilter.scss";

type GalleryFilterProps = {
  defaultQuery: string;
  defaultKind: PetKind | "all";
  defaultTags: string[];
  suggestedTags: string[];
};

const KIND_OPTIONS = [
  { value: "all", content: "All kinds" },
  { value: "creature", content: "Creatures" },
  { value: "object", content: "Objects" },
  { value: "character", content: "Characters" },
];

const SEARCH_DEBOUNCE_MS = 350;

export function GalleryFilter({
  defaultQuery,
  defaultKind,
  defaultTags,
  suggestedTags,
}: GalleryFilterProps) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultQuery);
  const [kind, setKind] = useState(defaultKind);
  const [tags, setTags] = useState(defaultTags);
  const [isPending, startTransition] = useTransition();
  const activeTags = new Set(tags);
  const hasAppliedFilters = hasGalleryFilters({
    query: defaultQuery,
    kind: defaultKind,
    tags: defaultTags,
  });
  const appliedHref = buildGalleryHref({
    query: defaultQuery,
    kind: defaultKind,
    tags: defaultTags,
  });
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastNavigatedHref = useRef(appliedHref);

  function cancelScheduledSearch() {
    if (debounceTimer.current !== null) {
      clearTimeout(debounceTimer.current);
      debounceTimer.current = null;
    }
  }

  // Sync local state from the URL on external navigation (back/forward).
  // URLs this component navigated to itself are skipped so in-progress
  // typing is not clobbered. The cleanup drops a pending debounce when
  // the applied URL changes or the component unmounts.
  useEffect(() => {
    if (appliedHref !== lastNavigatedHref.current) {
      lastNavigatedHref.current = appliedHref;
      setQuery(defaultQuery);
      setKind(defaultKind);
      setTags(defaultTags);
    }
    return cancelScheduledSearch;
  }, [appliedHref, defaultQuery, defaultKind, defaultTags]);

  function navigate(targetHref: string, mode: "push" | "replace") {
    cancelScheduledSearch();
    lastNavigatedHref.current = targetHref;
    startTransition(() => {
      if (mode === "push") {
        router.push(targetHref, { scroll: false });
      } else {
        router.replace(targetHref, { scroll: false });
      }
    });
  }

  function scheduleSearch(nextQuery: string) {
    cancelScheduledSearch();
    const targetHref = buildGalleryHref({ query: nextQuery, kind, tags });
    if (targetHref === appliedHref) return;
    debounceTimer.current = setTimeout(() => {
      debounceTimer.current = null;
      navigate(targetHref, "replace");
    }, SEARCH_DEBOUNCE_MS);
  }

  function onQueryUpdate(value: string) {
    setQuery(value);
    scheduleSearch(value);
  }

  function onKindUpdate(values: string[]) {
    const nextKind = parseGalleryKind(values[0]);
    setKind(nextKind);
    const targetHref = buildGalleryHref({ query, kind: nextKind, tags });
    if (targetHref === appliedHref) return;
    navigate(targetHref, "replace");
  }

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const targetHref = buildGalleryHref({ query, kind, tags });
    if (targetHref === appliedHref) return;
    navigate(targetHref, "push");
  }

  function onClear() {
    setQuery("");
    setKind("all");
    setTags([]);
    if (appliedHref === "/") {
      cancelScheduledSearch();
      return;
    }
    navigate("/", "push");
  }

  function onToggleTag(tag: string) {
    const wasSelected = activeTags.has(tag);
    const nextTags = wasSelected
      ? tags.filter((value) => value !== tag)
      : normalizeGalleryTags([...tags, tag]);
    setTags(nextTags);
    trackGoal("gallery_tag_filter_toggle", {
      action: wasSelected ? "remove" : "add",
      tag,
      tags: nextTags,
      tagCount: nextTags.length,
      kind,
      hasQuery: Boolean(query.trim()),
    });
    navigate(buildGalleryHref({ query, kind, tags: nextTags }), "push");
  }

  return (
    <Card view="filled" type="container" className="gallery-filter-card">
      <form onSubmit={onSubmit}>
        <Flex gap={3} direction="row" alignItems="center" wrap>
          <Flex grow={1} className="gallery-filter-card__search">
            <TextInput
              value={query}
              onUpdate={onQueryUpdate}
              placeholder="Search by name, tag, or vibe"
              hasClear
              size="l"
              startContent={
                <span className="gallery-filter-card__icon">
                  <Magnifier />
                </span>
              }
              endContent={isPending ? <Spin size="s" /> : undefined}
            />
          </Flex>
          <Flex className="gallery-filter-card__select">
            <Select
              value={[kind]}
              onUpdate={onKindUpdate}
              size="l"
              width="max"
              options={KIND_OPTIONS}
            />
          </Flex>
          <Flex gap={2} className="gallery-filter-card__actions">
            <Button
              type="button"
              view="outlined"
              size="l"
              onClick={onClear}
              disabled={
                !hasAppliedFilters &&
                !query.trim() &&
                kind === "all" &&
                activeTags.size === 0
              }
            >
              <Xmark />
              Clear
            </Button>
          </Flex>
        </Flex>
        {suggestedTags.length > 0 ? (
          <div
            className="gallery-filter-card__tags"
            aria-label="Suggested tags"
          >
            {suggestedTags.map((tag) => {
              const selected = activeTags.has(tag);
              return (
                <Button
                  key={tag}
                  type="button"
                  view={selected ? "action" : "outlined"}
                  size="m"
                  selected={selected}
                  onClick={() => onToggleTag(tag)}
                  extraProps={{ "aria-pressed": selected }}
                  className="gallery-filter-card__tag"
                >
                  #{tag}
                </Button>
              );
            })}
          </div>
        ) : null}
      </form>
    </Card>
  );
}
