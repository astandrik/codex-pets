import type { Metadata } from "next";
import { Container } from "@/components/GravityUI/GravityUI";
import { PetGenerationForm } from "@/components/PetGenerationForm/PetGenerationForm";
import { generationEnabled, generationReviewFlowEnabled } from "@/lib/pets/generation/model";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Generate a pet", robots: { index:false,follow:false,noarchive:true },referrer:"no-referrer" };
export default function GeneratePage() {
  const reviewBase = generationReviewFlowEnabled();
  return <Container as="main" maxWidth="xl" gutters={0}>
    <PetGenerationForm enabled={generationEnabled()} reviewBase={reviewBase} />
  </Container>;
}
