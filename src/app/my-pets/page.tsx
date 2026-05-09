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
import { MyPetActions } from "@/components/MyPetActions/MyPetActions";

function EmptyIcon() {
  return <Picture width={64} height={64} />;
}
import { PetCard } from "@/components/PetCard/PetCard";
import { getCurrentPrincipal } from "@/lib/auth/session";
import { listPetsForOwner } from "@/lib/pets/repository";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "My pets",
  description: "Track Codex pet submissions for your account.",
  robots: {
    index: false,
    follow: false,
  },
};

export default async function MyPetsPage() {
  const principal = await getCurrentPrincipal();
  const pets = principal ? await listPetsForOwner(principal.userId) : [];

  return (
    <Container as="main" maxWidth="xl" className="page-shell">
      <Flex direction="column" gap={3} className="page-section-header">
        <Label theme="info">Account</Label>
        <Text variant="display-2" as="h1">
          My pets
        </Text>
        <Text variant="body-2" color="secondary">
          Track pending, approved, and rejected packages submitted from your
          account.
        </Text>
      </Flex>

      <section className="page-section">
        {!principal ? (
          <PlaceholderContainer
            size="l"
            image={<EmptyIcon />}
            title="Sign in to see your pets"
            description="Submissions tied to your account will appear here once you sign in."
            actions={
              <Flex gap={2}>
                <Button view="action" href="/login">
                  Login
                </Button>
                <Button view="outlined" href="/register">
                  Create account
                </Button>
              </Flex>
            }
          />
        ) : pets.length > 0 ? (
          <div className="pet-grid">
            {pets.map((pet) => (
              <Flex direction="column" gap={2} key={pet.slug}>
                <PetCard pet={pet} showStatus />
                <Flex justifyContent="flex-end">
                  <MyPetActions petId={pet.id} />
                </Flex>
              </Flex>
            ))}
          </div>
        ) : (
          <PlaceholderContainer
            size="l"
            image={<EmptyIcon />}
            title="No submissions yet"
            description="Pets you submit from this account will appear here."
            actions={
              <Button view="action" href="/submit">
                Submit a pet
              </Button>
            }
          />
        )}
      </section>

      <Text variant="caption-2" color="secondary" className="page-section">
        Need help? Visit the <Link href="/">gallery</Link> for public listings.
      </Text>
    </Container>
  );
}
