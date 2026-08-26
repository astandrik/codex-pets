"use client";

import { useMemo } from "react";
import Link from "next/link";
import {
  Flex,
  Label,
  Table,
  type TableColumnConfig,
  Text,
} from "@gravity-ui/uikit";

import { AdminSubmissionActions } from "@/components/AdminSubmissionActions/AdminSubmissionActions";
import { kindLabelTheme, statusLabelText, statusLabelTheme } from "@/lib/ui/labels";
import { formatUtcDateTime } from "@/lib/ui/dates";
import type { ApprovalStatus, PetKind } from "@/lib/pets/types";
import "./SubmissionsTable.scss";

export type SubmissionRow = {
  id: string;
  slug: string;
  displayName: string;
  description: string;
  kind: PetKind;
  status: ApprovalStatus;
  createdAt: string;
  ownerName: string | null;
  ownerProfileSlug: string | null;
  contactEmail: string | null;
  publicEmailRequested: boolean;
};

type SubmissionsTableProps = {
  rows: SubmissionRow[];
};

export function SubmissionsTable({ rows }: SubmissionsTableProps) {
  const columns: TableColumnConfig<SubmissionRow>[] = useMemo(
    () => [
      {
        id: "displayName",
        name: "Pet",
        template: (row) => (
          <Flex direction="column" gap={1}>
            <Link href={`/pets/${row.slug}`} className="submissions-table__title">
              {row.displayName}
            </Link>
            <Text variant="caption-2" color="secondary" ellipsis>
              {row.description}
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
          <Label theme={statusLabelTheme(row.status)} size="s">
            {statusLabelText(row.status)}
          </Label>
        ),
        width: 120,
      },
      {
        id: "owner",
        name: "Submitted by",
        template: (row) => {
          if (row.ownerProfileSlug) {
            return (
              <Link href={`/users/${row.ownerProfileSlug}`}>
                {row.ownerName ?? row.ownerProfileSlug}
              </Link>
            );
          }
          return (
            <Flex direction="column" gap={1}>
              <span>
                {row.ownerName ?? row.contactEmail ?? (
                  <Text color="secondary">anonymous</Text>
                )}
              </span>
              {row.publicEmailRequested ? (
                <Label theme="info" size="s">
                  Public email requested
                </Label>
              ) : null}
            </Flex>
          );
        },
        width: 200,
      },
      {
        id: "createdAt",
        name: "Submitted",
        template: (row) => (
          <Text variant="caption-2">
            {formatUtcDateTime(row.createdAt)}
          </Text>
        ),
        width: 180,
      },
      {
        id: "actions",
        name: "",
        template: (row) => (
          <AdminSubmissionActions
            petId={row.id}
            publicEmailRequested={row.publicEmailRequested}
            contactEmail={row.contactEmail}
          />
        ),
        width: 220,
      },
    ],
    [],
  );

  return (
    <Flex direction="column" gap={3} className="submissions-table">
      <Flex justifyContent="flex-end">
        <Text variant="caption-2" color="secondary">
          {rows.length} pending {rows.length === 1 ? "row" : "rows"}
        </Text>
      </Flex>
      <Table
        data={rows}
        columns={columns}
        emptyMessage="No submissions to review."
      />
    </Flex>
  );
}
