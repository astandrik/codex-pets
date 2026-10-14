import type { Metadata } from "next";
import { Container, Flex, Text } from "@/components/GravityUI/GravityUI";
import { PetGenerationForm } from "@/components/PetGenerationForm/PetGenerationForm";
import { generationEnabled } from "@/lib/pets/generation/model";
import { withBasePath } from "@/lib/base-path";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Generate a pet", robots: { index:false,follow:false,noarchive:true },referrer:"no-referrer" };
export default function GeneratePage() {
  return <Container as="main" maxWidth="xl" gutters={5} className="page-shell">
    <Flex direction="column" gap={3} className="page-section-header">
      <Text variant="display-2" as="h1">Generate a pet</Text>
      <Text variant="body-2" color="secondary">Describe a character and create an animated v2 pet, without registration. Generation is funded by this service: up to 200 accepted tasks per day, and 10 per IP, resetting at midnight Moscow time.</Text>
      <p>The result is private for 24 hours from acceptance. Preview and download the package, choose its gallery address, and submit it for moderation from the result page.</p>
    </Flex>
    <p><a href={withBasePath("/my-generations")}>My generations — check your tasks and open saved results</a>.</p>
    <section className="page-section"><PetGenerationForm enabled={generationEnabled()} /></section>
    <p><a href={withBasePath("/guides/ai-pet-generator")}>How generation works, limits and publishing</a>.</p>
    <p>Need help from the gallery admins? <a href={withBasePath("/request")}>Send a manual request</a>.</p>
  </Container>;
}
