"use client";

import { FormEvent, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Button,
  Card,
  Flex,
  Select,
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
  const activeTags = new Set(tags);
  const hasAppliedFilters = hasGalleryFilters({
    query: defaultQuery,
    kind: defaultKind,
    tags: defaultTags,
  });

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    router.push(buildGalleryHref({ query, kind, tags }), { scroll: false });
  }

  function onClear() {
    setQuery("");
    setKind("all");
    setTags([]);
    router.push("/", { scroll: false });
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
    router.push(buildGalleryHref({ query, kind, tags: nextTags }), {
      scroll: false,
    });
  }

  return (
    <Card view="filled" type="container" className="gallery-filter-card">
      <form onSubmit={onSubmit}>
        <Flex gap={3} direction="row" alignItems="center" wrap>
          <Flex grow={1} className="gallery-filter-card__search">
            <TextInput
              value={query}
              onUpdate={setQuery}
              placeholder="Search by name, tag, or vibe"
              hasClear
              size="l"
              startContent={
                <span className="gallery-filter-card__icon">
                  <Magnifier />
                </span>
              }
            />
          </Flex>
          <Flex className="gallery-filter-card__select">
            <Select
              value={[kind]}
              onUpdate={(values) => setKind(parseGalleryKind(values[0]))}
              size="l"
              width="max"
              options={KIND_OPTIONS}
            />
          </Flex>
          <Flex gap={2} className="gallery-filter-card__actions">
            <Button type="submit" view="action" size="l">
              <Magnifier />
              Apply
            </Button>
            <Button
              type="button"
              view="outlined"
              size="l"
              onClick={onClear}
              disabled={!hasAppliedFilters}
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
