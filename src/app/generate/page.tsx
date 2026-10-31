import type { Metadata } from "next";
import { Container } from "@/components/GravityUI/GravityUI";
import { PetGenerationForm } from "@/components/PetGenerationForm/PetGenerationForm";
import { GenerationError, generationEnabled, generationReviewFlowEnabled, generationAnimationAutoRepairEnabled, generationQueueLimit } from "@/lib/pets/generation/model";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Generate a pet", robots: { index:false,follow:false,noarchive:true },referrer:"no-referrer" };
export default function GeneratePage() {
  const reviewBase = generationReviewFlowEnabled();
  let queueLimit: number | null = null;
  try {
    queueLimit = generationQueueLimit();
  } catch (error) {
    if (!(error instanceof GenerationError) || error.code !== "generation_not_configured") throw error;
  }
  return <Container as="main" maxWidth="xl" gutters={0}>
    <PetGenerationForm enabled={generationEnabled()} reviewBase={reviewBase} automaticAnimationRepair={generationAnimationAutoRepairEnabled()} queueLimit={queueLimit} />
  </Container>;
}
