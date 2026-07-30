import { Text } from "@/components/GravityUI/GravityUI";
import { PetCard } from "@/components/PetCard/PetCard";
import type { PublicPet } from "@/lib/pets/types";
import "./related-pets.scss";

type RelatedPetsProps = {
  pets: PublicPet[];
};

export function RelatedPets({ pets }: RelatedPetsProps) {
  return (
    <section className="related-pets" aria-label="Related pets">
      <Text variant="subheader-2" as="h2" className="related-pets__title">
        Related pets
      </Text>
      <div className="pet-grid related-pets__grid">
        {pets.map((pet) => (
          <PetCard key={pet.slug} pet={pet} />
        ))}
      </div>
    </section>
  );
}
