import { Text } from "@/components/GravityUI/GravityUI";
import { PetCard } from "@/components/PetCard/PetCard";
import { RelatedPetsAnalytics } from "@/components/RelatedPets/RelatedPetsAnalytics";
import type { PublicPet } from "@/lib/pets/types";
import "./related-pets.scss";

type RelatedPetsProps = {
  pets: PublicPet[];
  sourceSlug: string;
};

export function RelatedPets({ pets, sourceSlug }: RelatedPetsProps) {
  return (
    <section className="related-pets" aria-label="Related pets">
      <Text variant="subheader-2" as="h2" className="related-pets__title">
        Related pets
      </Text>
      <RelatedPetsAnalytics sourceSlug={sourceSlug}>
        {pets.map((pet, index) => (
          <div
            key={pet.slug}
            className="related-pets__item"
            data-related-pet-slug={pet.slug}
            data-related-pet-position={index + 1}
          >
            <PetCard
              pet={pet}
              relatedContext={{
                sourceSlug,
                targetSlug: pet.slug,
                position: index + 1,
              }}
            />
          </div>
        ))}
      </RelatedPetsAnalytics>
    </section>
  );
}
