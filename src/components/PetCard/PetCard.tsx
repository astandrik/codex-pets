import Link from "next/link";

import { PET_SHEET } from "@/lib/pets/types";
import type { PublicPet } from "@/lib/pets/types";
import "./PetCard.scss";

type PetCardProps = {
  pet: PublicPet;
  showStatus?: boolean;
};

export function PetCard({ pet, showStatus = false }: PetCardProps) {
  return (
    <Link className="pet-card panel" href={`/pets/${pet.slug}`}>
      <div className="pet-card__sprite-wrap">
        <div
          className="pet-card__sprite"
          aria-hidden
          style={{
            backgroundImage: `url(${pet.spritesheetUrl})`,
            backgroundSize: `${PET_SHEET.columns * 100}% ${PET_SHEET.rows * 100}%`,
            backgroundPosition: "0% 0%",
          }}
        />
      </div>
      <div className="pet-card__body">
        <div className="pet-card__meta">
          <span className="pill">{pet.kind}</span>
          {showStatus ? <span className="pill">{pet.status}</span> : null}
        </div>
        <h3>{pet.displayName}</h3>
        <p>{pet.description}</p>
        <div className="pet-card__tags">
          {pet.tags.slice(0, 4).map((tag) => (
            <span key={tag}>#{tag}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}
