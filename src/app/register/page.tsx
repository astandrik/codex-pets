import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container, Flex, Label, Text } from "@/components/GravityUI/GravityUI";

import { AuthForm } from "@/components/AuthForm/AuthForm";
import { getCurrentPrincipal } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Create account",
  description: "Create an account to track your Codex Pets submissions.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function RegisterPage() {
  const principal = await getCurrentPrincipal();
  if (principal) {
    redirect("/my-pets");
  }

  return (
    <Container as="main" maxWidth="m" className="page-shell">
      <Flex direction="column" gap={3} className="page-section-header auth-page-header">
        <Label theme="info">Account</Label>
        <Text variant="display-2" as="h1">
          Create account
        </Text>
        <Text variant="body-2" color="secondary">
          Create a local account to track your own submissions and use private
          account pages.
        </Text>
      </Flex>
      <section className="page-section">
        <AuthForm mode="register" />
      </section>
    </Container>
  );
}
