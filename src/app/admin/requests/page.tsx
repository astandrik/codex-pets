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
  GenerationRequestsTable,
  type GenerationRequestRow,
} from "@/components/GenerationRequestsTable/GenerationRequestsTable";
import { getCurrentPrincipal, isAdminUser } from "@/lib/auth/session";
import { withBasePath } from "@/lib/base-path";
import { listGenerationRequests } from "@/lib/pets/generation-requests-repository";

function EmptyIcon() {
  return <Picture width={64} height={64} />;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Pet generation requests",
  description: "Admin queue for Codex pet generation requests.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function AdminRequestsPage() {
  const principal = await getCurrentPrincipal();
  const isAdmin = isAdminUser(principal);
  const requests = isAdmin ? await listGenerationRequests() : [];
  const rows: GenerationRequestRow[] = requests.map((request) => ({
    id: request.id,
    status: request.status,
    kind: request.kind,
    displayNameHint: request.displayNameHint,
    prompt: request.prompt,
    contactEmail: request.contactEmail,
    requesterName: request.requesterName,
    linkedPetSlug: request.linkedPetSlug,
    referenceImage: request.referenceImage,
    adminNote: request.adminNote,
    createdAt: request.createdAt,
  }));

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      <Flex direction="column" gap={3} className="page-section-header">
        <Label theme="warning">Admin</Label>
        <Text variant="display-2" as="h1">
          Pet generation requests
        </Text>
        <Text variant="body-2" color="secondary">
          Private queue for incoming pet generation briefs and manual
          fulfillment links.
        </Text>
      </Flex>

      <section className="page-section">
        {!principal ? (
          <PlaceholderContainer
            size="l"
            image={<EmptyIcon />}
            title="Sign in required"
            description="Sign in with an admin account to open the request queue."
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
          <GenerationRequestsTable rows={rows} />
        ) : (
          <PlaceholderContainer
            size="l"
            image={<EmptyIcon />}
            title="Inbox zero"
            description="No pet generation requests right now."
          />
        )}
      </section>
    </Container>
  );
}
