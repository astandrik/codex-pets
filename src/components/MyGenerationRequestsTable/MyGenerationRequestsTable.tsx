"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Flex,
  Label,
  Table,
  Text,
  type TableColumnConfig,
} from "@gravity-ui/uikit";

import type {
  GenerationRequestStatus,
  PetGenerationRequestReferenceImage,
  PetKind,
} from "@/lib/pets/types";
import { formatUtcDateTime } from "@/lib/ui/dates";
import {
  generationRequestStatusLabelText,
  generationRequestStatusLabelTheme,
  kindLabelTheme,
} from "@/lib/ui/labels";
import "./MyGenerationRequestsTable.scss";

export type MyGenerationRequestRow = {
  id: string;
  status: GenerationRequestStatus;
  kind: PetKind;
  displayNameHint: string | null;
  prompt: string;
  linkedPetSlug: string | null;
  referenceImage: PetGenerationRequestReferenceImage | null;
  createdAt: string;
};

type MyGenerationRequestsTableProps = {
  rows: MyGenerationRequestRow[];
};

export function MyGenerationRequestsTable({
  rows,
}: MyGenerationRequestsTableProps) {
  const columns: TableColumnConfig<MyGenerationRequestRow>[] = useMemo(
    () => [
      {
        id: "request",
        name: "Request",
        template: (row) => (
          <Flex direction="column" gap={1} className="my-generation-requests-table__request">
            <Text variant="body-2">
              {row.displayNameHint ?? "Untitled pet"}
            </Text>
            {row.referenceImage ? (
              <a
                href={row.referenceImage.url}
                target="_blank"
                rel="noreferrer"
                className="my-generation-requests-table__reference"
              >
                <span
                  aria-hidden="true"
                  className="my-generation-requests-table__reference-image"
                  style={{
                    backgroundImage: `url("${row.referenceImage.url}")`,
                  }}
                />
                <Text variant="caption-2">Reference image</Text>
              </a>
            ) : null}
            <Text variant="caption-2" color="secondary">
              {row.prompt}
            </Text>
          </Flex>
        ),
      },
      {
        id: "kind",
        name: "Kind",
        template: (row) => (
          <Label theme={kindLabelTheme(row.kind)} size="s">
            {row.kind}
          </Label>
        ),
        width: 110,
      },
      {
        id: "status",
        name: "Status",
        template: (row) => (
          <Label
            theme={generationRequestStatusLabelTheme(row.status)}
            size="s"
          >
            {generationRequestStatusLabelText(row.status)}
          </Label>
        ),
        width: 130,
      },
      {
        id: "linkedPet",
        name: "Pet",
        template: (row) =>
          row.linkedPetSlug ? (
            <Link
              href={`/pets/${row.linkedPetSlug}`}
              className="my-generation-requests-table__link"
            >
              {row.linkedPetSlug}
            </Link>
          ) : (
            <Text color="secondary">not linked</Text>
          ),
        width: 160,
      },
      {
        id: "createdAt",
        name: "Created",
        template: (row) => (
          <Text variant="caption-2">
            {formatUtcDateTime(row.createdAt)}
          </Text>
        ),
        width: 180,
      },
    ],
    [],
  );

  return (
    <Flex direction="column" gap={3} className="my-generation-requests-table">
      <Flex justifyContent="flex-end">
        <Text variant="caption-2" color="secondary">
          {rows.length} {rows.length === 1 ? "request" : "requests"}
        </Text>
      </Flex>
      <Table
        data={rows}
        columns={columns}
        emptyMessage="No pet generation requests."
      />
    </Flex>
  );
}
