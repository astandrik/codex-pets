import type { Metadata } from "next";
import {
  Button,
  Container,
  Flex,
  Label,
  PlaceholderContainer,
  Text,
} from "@/components/GravityUI/GravityUI";
import { Person } from "@gravity-ui/icons";

import { ProfileForm } from "@/components/ProfileForm/ProfileForm";
import { avatarUrlFromId } from "@/lib/auth/avatar-repository";
import { getUserById } from "@/lib/auth/repository";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { withBasePath } from "@/lib/base-path";
import { getPageViewOtherMetadata } from "@/lib/site-metadata";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Profile",
  description: "Edit your Codex Pets public profile.",
  other: getPageViewOtherMetadata("/profile", "Profile"),
  robots: {
    index: false,
    follow: false,
  },
};

function EmptyIcon() {
  return <Person width={64} height={64} />;
}

export default async function ProfilePage() {
  const principal = await getCurrentPrincipal();
  const user = principal ? await getUserById(principal.userId) : null;

  return (
    <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
      <Flex direction="column" gap={3} className="page-section-header">
        <Label theme="info">Account</Label>
        <Text variant="display-2" as="h1">
          Profile
        </Text>
        <Text variant="body-2" color="secondary">
          Edit the public name, handle, bio, and links shown on your creator
          page.
        </Text>
      </Flex>

      <section className="page-section">
        {!principal ? (
          <PlaceholderContainer
            size="l"
            image={<EmptyIcon />}
            title="Sign in to edit your profile"
            description="Local account profiles can be edited after sign in."
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
        ) : user ? (
          <ProfileForm
            email={user.email}
            displayName={user.displayName}
            profileSlug={user.profileSlug}
            bio={user.bio}
            websiteUrl={user.websiteUrl}
            githubUrl={user.githubUrl}
            linkedinUrl={user.linkedinUrl}
            avatarUrl={avatarUrlFromId(user.avatarId)}
          />
        ) : (
          <PlaceholderContainer
            size="l"
            image={<EmptyIcon />}
            title="Profile is not editable"
            description="This auth mode does not have a local account profile."
          />
        )}
      </section>
    </Container>
  );
}
