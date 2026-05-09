import type { Metadata } from "next";

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

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pending submissions",
  description: "Admin moderation queue for Codex Pets submissions.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminSubmissionsPage() {
  const principal = await getCurrentPrincipal();
  const isAdmin = isAdminUser(principal);
  const pets = isAdmin ? await listPendingPets() : [];
  const rows: SubmissionRow[] = pets.map((pet) => ({
    id: pet.id,
    slug: pet.slug,
    displayName: pet.displayName,
    description: pet.description,
    kind: pet.kind,
    status: pet.status,
    createdAt: pet.createdAt,
    ownerName: pet.ownerName,
    contactEmail: pet.contactEmail,
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
