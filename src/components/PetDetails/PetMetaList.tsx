"use client";

import { DefinitionList, Flex, Label } from "@gravity-ui/uikit";

import type { PublicPet } from "@/lib/pets/types";

type PetMetaListProps = Pick<
  PublicPet,
  | "slug"
  | "kind"
  | "ownerName"
  | "createdAt"
  | "approvedAt"
  | "tags"
>;

export function PetMetaList({
  slug,
  kind,
  ownerName,
  createdAt,
  approvedAt,
  tags,
}: PetMetaListProps) {
  return (
    <DefinitionList responsive>
      <DefinitionList.Item name="Slug">
        <code>{slug}</code>
      </DefinitionList.Item>
      <DefinitionList.Item name="Kind">{kind}</DefinitionList.Item>
      <DefinitionList.Item name="Author">
        {ownerName ?? "Anonymous"}
      </DefinitionList.Item>
      <DefinitionList.Item name="Submitted">
        {new Date(createdAt).toLocaleString()}
      </DefinitionList.Item>
      {approvedAt ? (
        <DefinitionList.Item name="Approved">
          {new Date(approvedAt).toLocaleString()}
        </DefinitionList.Item>
      ) : null}
      {tags.length > 0 ? (
        <DefinitionList.Item name="Tags">
          <Flex gap={1} wrap>
            {tags.map((tag) => (
              <Label key={tag} theme="unknown" size="s">
                #{tag}
              </Label>
            ))}
          </Flex>
        </DefinitionList.Item>
      ) : null}
    </DefinitionList>
  );
}
