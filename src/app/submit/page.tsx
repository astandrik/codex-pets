import type { Metadata } from "next";

import { Container, Flex, Label, Text } from "@/components/GravityUI/GravityUI";

import { SubmitForm } from "@/components/SubmitForm/SubmitForm";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { withBasePath } from "@/lib/base-path";
import {
  getOpenGraphImages,
  getTwitterImages,
  SITE_NAME,
} from "@/lib/site-metadata";

export const dynamic = "force-dynamic";

const submitDescription =
  "Submit a Codex pet pack with pet.json and a validated spritesheet for review in the community gallery.";

export const metadata: Metadata = {
  title: "Submit a Codex pet",
  description: submitDescription,
  alternates: {
    canonical: withBasePath("/submit"),
  },
  openGraph: {
    type: "website",
    siteName: SITE_NAME,
    title: "Submit a Codex pet",
    description: submitDescription,
    url: withBasePath("/submit"),
    images: getOpenGraphImages(),
  },
  twitter: {
    card: "summary_large_image",
    title: "Submit a Codex pet",
    description: submitDescription,
    images: getTwitterImages(),
  },
};

export default async function SubmitPage() {
  const principal = await getCurrentPrincipal();

  return (
    <Container as="main" maxWidth="xl" className="page-shell">
      <Flex direction="column" gap={3} className="page-section-header">
        <Label theme="info">Upload</Label>
        <Text variant="display-2" as="h1">
          Submit a Codex pet
        </Text>
        <Text variant="body-2" color="secondary" className="page-section-header__lead">
          Upload a ZIP or the two root files: <code>pet.json</code> and{" "}
          <code>spritesheet.webp</code>/<code>spritesheet.png</code>. New pets
          stay pending until an admin approves them. You can submit
          anonymously or sign in to track your own submissions.
        </Text>
      </Flex>
      <section className="page-section">
        <SubmitForm
          isAuthenticated={Boolean(principal)}
          defaultContactEmail={principal?.email ?? null}
        />
      </section>
    </Container>
  );
}
