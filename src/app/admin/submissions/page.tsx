import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { AdminQueuePagination, adminQueueHref } from "@/components/AdminQueuePagination/AdminQueuePagination";
import { parseCatalogPage } from "@/lib/pets/pagination";

import {
  Button,
  Container,
  Flex,
  Label,
  PlaceholderContainer,
  Text,
} from "@/components/GravityUI/GravityUI";

import { Picture } from "@gravity-ui/icons";

import {
  SubmissionsTable,
  type SubmissionRow,
} from "@/components/SubmissionsTable/SubmissionsTable";
import { withBasePath } from "@/lib/base-path";

function EmptyIcon() {
  return <Picture width={64} height={64} />;
}
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { listPendingPets } from "@/lib/pets/repository";
import { getPageViewOtherMetadata } from "@/lib/site-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pending submissions",
  description: "Admin moderation queue for Codex Pets submissions.",
  other: getPageViewOtherMetadata(
    "/admin/submissions",
    "Pending submissions",
  ),
  robots: {
    index: false,
    follow: false,
  },
};

type PageProps = {
  searchParams?: Promise<Record<string, string | string[] | undefined>>;
};

export default async function AdminSubmissionsPage({ searchParams }: PageProps) {
  const principal = await getCurrentPrincipal();
  const isAdmin = isAdminUser(principal);
  const parsed = isAdmin ? parseCatalogPage(await searchParams) : { ok: true as const, page: 1 };
  if (!parsed.ok) notFound();
  const queue = isAdmin ? await listPendingPets(parsed.page) : null;
  if (queue && queue.pagination.page !== parsed.page) {
    redirect(adminQueueHref("/admin/submissions", queue.pagination.page));
  }
  const pets = queue?.items ?? [];
  const rows: SubmissionRow[] = pets.map((pet) => ({
    id: pet.id,
    slug: pet.slug,
    displayName: pet.displayName,
    description: pet.description,
    kind: pet.kind,
    status: pet.status,
    createdAt: pet.createdAt,
    ownerName: pet.ownerName,
    ownerProfileSlug: pet.ownerProfileSlug ?? null,
    contactEmail: pet.contactEmail,
    publicEmailRequested: pet.publicEmailRequested ?? false,
  }));

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      <Flex direction="column" gap={3} className="page-section-header">
        <Label theme="warning">Admin</Label>
        <Text variant="display-2" as="h1">
          Pending submissions
        </Text>
        <Text variant="body-2" color="secondary">
          Manual queue for approving or rejecting uploaded Codex pet packages.
        </Text>
      </Flex>

      {queue ? (
        <AdminQueuePagination
          pagination={queue.pagination}
          pathname="/admin/submissions"
          itemLabel="pending submissions"
        />
      ) : null}
      <section className="page-section">
        {!principal ? (
          <PlaceholderContainer
            size="l"
            image={<EmptyIcon />}
            title="Sign in required"
            description="Sign in with an admin account to open the moderation queue."
            actions={
              <Button view="action" href={withBasePath("/login")}>
                Login
              </Button>
            }
          />
        ) : !isAdmin ? (
          <PlaceholderContainer
            size="l"
            image={<EmptyIcon />}
            title="No admin access"
            description="This account does not have admin access."
          />
        ) : rows.length > 0 ? (
          <SubmissionsTable rows={rows} />
        ) : (
          <PlaceholderContainer
            size="l"
            image={<EmptyIcon />}
            title="Inbox zero"
            description="No pending submissions right now."
          />
        )}
      </section>
    </Container>
  );
}
