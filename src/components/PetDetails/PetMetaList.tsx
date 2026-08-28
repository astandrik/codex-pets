"use client";

import Link from "next/link";
import { DefinitionList, Flex, Label } from "@gravity-ui/uikit";

import type { PublicPet } from "@/lib/pets/types";
import { formatUtcDateTime } from "@/lib/ui/dates";

type PetMetaListProps = Pick<
  PublicPet,
  | "slug"
  | "kind"
  | "ownerName"
  | "ownerProfileSlug"
  | "publicAuthorEmail"
  | "createdAt"
  | "approvedAt"
  | "tags"
>;

export function PetMetaList({
  slug,
  kind,
  ownerName,
  ownerProfileSlug,
  publicAuthorEmail,
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
        {ownerProfileSlug ? (
          <Link href={`/users/${ownerProfileSlug}`}>{ownerName ?? "Anonymous"}</Link>
        ) : (
          ownerName ?? "Anonymous"
        )}
      </DefinitionList.Item>
      {publicAuthorEmail ? (
        <DefinitionList.Item name="Email">
          <a href={`mailto:${publicAuthorEmail}`}>{publicAuthorEmail}</a>
        </DefinitionList.Item>
      ) : null}
      <DefinitionList.Item name="Submitted">
        {formatUtcDateTime(createdAt)}
      </DefinitionList.Item>
      {approvedAt ? (
        <DefinitionList.Item name="Approved">
          {formatUtcDateTime(approvedAt)}
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
