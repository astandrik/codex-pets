import Link from "next/link";
import { Text } from "@/components/GravityUI/GravityUI";
import {
  formatRelatedPetDescription,
  type RelatedPetCandidate,
} from "@/lib/pets/related-pets";
import "./related-pets.scss";

type RelatedPetsProps = {
  pets: RelatedPetCandidate[];
};

export function RelatedPets({ pets }: RelatedPetsProps) {
  return (
    <section className="related-pets" aria-label="Related pets">
      <Text variant="subheader-2" as="h2" className="related-pets__title">
        Related pets
      </Text>
      <ul className="related-pets__list">
        {pets.map((pet) => (
          <li key={pet.slug} className="related-pets__item">
            <Link href={`/pets/${pet.slug}`} className="related-pets__link">
              {pet.displayName}
            </Link>
            <span className="related-pets__kind">{pet.kind}</span>
            <span className="related-pets__description">
              {formatRelatedPetDescription(pet.description)}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
