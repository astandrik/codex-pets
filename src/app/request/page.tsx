import type { Metadata } from "next";

import { AskAIPanel } from "@/components/AskAI/AskAIPanel";
import {
  ASK_AI_PRODUCT_NAME,
  ASK_AI_REQUEST,
} from "@/components/AskAI/ask-ai-content";
import { Container, Flex, Label, Text } from "@/components/GravityUI/GravityUI";
import { PetRequestForm } from "@/components/PetRequestForm/PetRequestForm";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { withBasePath } from "@/lib/base-path";
import {
  getOpenGraphImages,
  getPageViewOtherMetadata,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";

export const dynamic = "force-dynamic";

const requestDescription =
  "Request a new Codex pet from the Companion Gallery admins.";

export const metadata: Metadata = {
  title: "Request a Codex pet",
  description: requestDescription,
  other: getPageViewOtherMetadata("/request", "Request a Codex pet"),
  alternates: {
    canonical: withBasePath("/request"),
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Request a Codex pet",
    description: requestDescription,
    url: withBasePath("/request"),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Request a Codex pet",
    description: requestDescription,
    images: getTwitterImages(),
  },
};

export default async function RequestPage() {
  const principal = await getCurrentPrincipal();

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      <Flex direction="column" gap={3} className="page-section-header">
        <Label theme="info">Request</Label>
        <Text variant="display-2" as="h1">
          Request a Codex pet
        </Text>
        <Text variant="body-2" color="secondary" className="page-section-header__lead">
          Send a short brief and optional reference image for a pet you want
          generated. Requests are visible only to admins, and completed pets are
          linked from the admin queue after they are uploaded.
        </Text>
      </Flex>
      <section className="page-section">
        <AskAIPanel
          productName={ASK_AI_PRODUCT_NAME}
          label={ASK_AI_REQUEST.label}
          helperText={ASK_AI_REQUEST.helperText}
          prompt={ASK_AI_REQUEST.prompt}
          page={ASK_AI_REQUEST.page}
          promptVariant={ASK_AI_REQUEST.promptVariant}
        />
      </section>
      <section className="page-section">
        <PetRequestForm
          defaultContactEmail={principal?.email ?? null}
          defaultRequesterName={principal?.name ?? null}
        />
      </section>
    </Container>
  );
}
