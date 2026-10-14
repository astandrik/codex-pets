import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { GENERATION_ID } from "@/lib/pets/generation/model";
import { GeneratedPetPreview } from "@/components/GeneratedPetPreview/GeneratedPetPreview";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Generated pet preview",
  robots: { index: false, follow: false, noarchive: true },
  referrer: "no-referrer",
};

export default async function GeneratedPetPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!GENERATION_ID.test(id)) notFound();
  return <GeneratedPetPreview generationId={id} />;
}
