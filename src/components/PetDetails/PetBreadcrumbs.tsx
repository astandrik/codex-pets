"use client";

import { Breadcrumbs } from "@gravity-ui/uikit";

import { withBasePath } from "@/lib/base-path";

type PetBreadcrumbsProps = {
  displayName: string;
};

export function PetBreadcrumbs({ displayName }: PetBreadcrumbsProps) {
  return (
    <Breadcrumbs className="pet-detail__breadcrumbs">
      <Breadcrumbs.Item href={withBasePath("/")}>Home</Breadcrumbs.Item>
      <Breadcrumbs.Item href={withBasePath("/")}>Gallery</Breadcrumbs.Item>
      <Breadcrumbs.Item>{displayName}</Breadcrumbs.Item>
    </Breadcrumbs>
  );
}
