import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Container, Flex, Label, Text } from "@/components/GravityUI/GravityUI";

import { AuthForm } from "@/components/AuthForm/AuthForm";
import { getCurrentPrincipal } from "@/lib/auth/session";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Sign in",
  description: "Sign in to manage your Codex Pets submissions.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function LoginPage() {
  const principal = await getCurrentPrincipal();
  if (principal) {
    redirect("/my-pets");
  }

  return (
    <Container as="main" maxWidth="m" className="page-shell">
      <Flex direction="column" gap={3} className="page-section-header auth-page-header">
        <Label theme="info">Account</Label>
        <Text variant="display-2" as="h1">
          Sign in
        </Text>
        <Text variant="body-2" color="secondary">
          Sign in to see your submissions and access private account pages.
        </Text>
      </Flex>
      <section className="page-section">
        <AuthForm mode="login" />
      </section>
    </Container>
  );
}
