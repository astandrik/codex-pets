// @vitest-environment jsdom
import {isValidElement, type ReactElement, type ReactNode} from "react";
import {describe, expect, it} from "vitest";
import {HomePage} from "./HomePage";
import {HomeHeroPetPicker, type HomeHeroPet} from "./HomeHeroPetPicker";
import type {PublicPetSummary} from "@/lib/pets/types";

const pickerKeys = [
  "slug", "displayName", "description", "kind", "ownerName",
  "ownerProfileSlug", "publicAuthorEmail", "spritesheetUrl",
].sort();

function findPicker(node: ReactNode): ReactElement<{pets: HomeHeroPet[]}> | null {
  if (Array.isArray(node)) return node.map(findPicker).find(Boolean) ?? null;
  if (!isValidElement(node)) return null;
  if (node.type === HomeHeroPetPicker) return node as ReactElement<{pets: HomeHeroPet[]}>;
  return findPicker((node.props as {children?: ReactNode}).children);
}

function createPet(index: number): PublicPetSummary {
  return {
    id: `id-${index}`, slug: `pet-${index}`, displayName: `Pet ${index}`,
    description: "A public test pet", kind: "creature", status: "approved", tags: ["blue"],
    spritesheetUrl: `/api/assets/${index}/spritesheet.webp`, petJsonUrl: `/api/assets/${index}/pet.json`,
    zipUrl: `/api/pets/pet-${index}/download`, spritesheetExt: "webp",
    ownerName: "Test author", ownerProfileSlug: "test-author", ownerAvatarUrl: "/avatar.svg",
    publicAuthorEmail: "public@example.test", createdAt: "2026-10-01T00:00:00Z",
    approvedAt: "2026-10-02T00:00:00Z", likeCount: 1, downloadCount: 2, installCount: 3,
  };
}

function pickerPets(pets: PublicPetSummary[]) {
  const picker = findPicker(HomePage({
    pets, totalPets: pets.length, catalogTotalPets: pets.length,
    showLandingContent: true, catalog: null,
  }));
  expect(picker).not.toBeNull();
  return picker!.props.pets;
}

describe("homepage client payload", () => {
  it("keeps the full catalog while sending only fields used by the picker", () => {
    const pets = Array.from({length: 50}, (_, index) => createPet(index));
    const sent = pickerPets(pets);
    expect(sent.map(pet => pet.slug)).toEqual(pets.map(pet => pet.slug));
    for (const [index, pet] of sent.entries()) {
      expect(Object.keys(pet).sort()).toEqual(pickerKeys);
      expect(pet.displayName).toBe(pets[index].displayName);
      expect(pet.spritesheetUrl).toBe(pets[index].spritesheetUrl);
      expect(pet.ownerProfileSlug).toBe(pets[index].ownerProfileSlug);
      expect(pet.publicAuthorEmail).toBe(pets[index].publicAuthorEmail);
    }
  });

  it("normalizes an absent public email without losing anonymous pets", () => {
    const pet = {...createPet(0), ownerName: null, ownerProfileSlug: null, publicAuthorEmail: undefined};
    expect(pickerPets([pet])[0]).toMatchObject({
      slug: pet.slug, ownerName: null, ownerProfileSlug: null, publicAuthorEmail: null,
    });
  });
});
