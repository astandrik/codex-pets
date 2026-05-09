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
import { Magnifier } from "@gravity-ui/icons";

import { withBasePath } from "@/lib/base-path";
import "./GalleryFilter.scss";

type GalleryFilterProps = {
  defaultQuery: string;
  defaultKind: string;
};

const KIND_OPTIONS = [
  { value: "all", content: "All kinds" },
  { value: "creature", content: "Creatures" },
  { value: "object", content: "Objects" },
  { value: "character", content: "Characters" },
];

export function GalleryFilter({ defaultQuery, defaultKind }: GalleryFilterProps) {
  const router = useRouter();
  const [query, setQuery] = useState(defaultQuery);
  const [kind, setKind] = useState(defaultKind);

  function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const params = new URLSearchParams();
    if (query.trim()) params.set("q", query.trim());
    if (kind && kind !== "all") params.set("kind", kind);
    const search = params.toString();
    router.push(withBasePath(search ? `/?${search}` : "/"));
  }

  function onReset() {
    setQuery("");
    setKind("all");
    router.push(withBasePath("/"));
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
              onUpdate={(values) => setKind(values[0] ?? "all")}
              size="l"
              width="max"
              options={KIND_OPTIONS}
            />
          </Flex>
          <Flex gap={2} className="gallery-filter-card__actions">
            <Button type="submit" view="action" size="l">
              Apply
            </Button>
            <Button type="button" view="outlined" size="l" onClick={onReset}>
              Reset
            </Button>
          </Flex>
        </Flex>
      </form>
    </Card>
  );
}
