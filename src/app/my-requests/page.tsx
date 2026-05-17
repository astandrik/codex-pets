import type { Metadata } from "next";
import Link from "next/link";
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
  MyGenerationRequestsTable,
  type MyGenerationRequestRow,
} from "@/components/MyGenerationRequestsTable/MyGenerationRequestsTable";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { withBasePath } from "@/lib/base-path";
import { listGenerationRequestsForUser } from "@/lib/pets/generation-requests-repository";

function EmptyIcon() {
  return <Picture width={64} height={64} />;
}

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My pet requests",
  description: "Track Codex pet generation requests for your account.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function MyRequestsPage() {
  const principal = await getCurrentPrincipal();
  const requests = principal
    ? await listGenerationRequestsForUser(principal.userId)
    : [];
  const rows: MyGenerationRequestRow[] = requests.map((request) => ({
    id: request.id,
    status: request.status,
    kind: request.kind,
    displayNameHint: request.displayNameHint,
    prompt: request.prompt,
    linkedPetSlug: request.linkedPetSlug,
    referenceImage: request.referenceImage,
    createdAt: request.createdAt,
  }));

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      <Flex direction="column" gap={3} className="page-section-header">
        <Label theme="info">Account</Label>
        <Text variant="display-2" as="h1">
          My pet requests
        </Text>
        <Text variant="body-2" color="secondary">
          Track generation requests sent while signed in to this account.
        </Text>
      </Flex>

      <section className="page-section">
        {!principal ? (
          <PlaceholderContainer
            size="l"
            image={<EmptyIcon />}
            title="Sign in to see your requests"
            description="Generation requests tied to your account will appear here once you sign in."
            actions={
              <Flex gap={2}>
                <Button view="action" href={withBasePath("/login")}>
                  Login
                </Button>
                <Button view="outlined" href={withBasePath("/register")}>
                  Create account
                </Button>
              </Flex>
            }
          />
        ) : rows.length > 0 ? (
          <MyGenerationRequestsTable rows={rows} />
        ) : (
          <PlaceholderContainer
            size="l"
            image={<EmptyIcon />}
            title="No requests yet"
            description="Pet generation requests you send from this account will appear here."
            actions={
              <Button view="action" href={withBasePath("/request")}>
                Request a pet
              </Button>
            }
          />
        )}
      </section>

      <Text variant="caption-2" color="secondary" className="page-section">
        Need to upload a finished pack instead? Use the{" "}
        <Link href="/submit">submit flow</Link>.
      </Text>
    </Container>
  );
}
