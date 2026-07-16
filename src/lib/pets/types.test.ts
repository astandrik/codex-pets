import { describe, expect, it } from "vitest";

describe("v2 look directions", () => {
  it("maps all 16 clockwise directions onto atlas rows 9 and 10", async () => {
    const petTypes = await import("@/lib/pets/types");
    expect("getLookDirectionCell" in petTypes).toBe(true);

    const getLookDirectionCell = (
      petTypes as unknown as {
        getLookDirectionCell: (index: number) => {
          row: number;
          column: number;
          degrees: number;
          displayDegrees: string;
          label: string;
        } | null;
      }
    ).getLookDirectionCell;

    const allDirections = Array.from({ length: 16 }, (_, index) =>
      getLookDirectionCell(index),
    );
    expect(allDirections.map((direction) => direction?.row)).toEqual([
      9, 9, 9, 9, 9, 9, 9, 9, 10, 10, 10, 10, 10, 10, 10, 10,
    ]);
    expect(allDirections.map((direction) => direction?.column)).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7,
    ]);
    expect(allDirections.map((direction) => direction?.degrees)).toEqual(
      Array.from({ length: 16 }, (_, index) => index * 22.5),
    );

    expect(getLookDirectionCell(0)).toMatchObject({
      row: 9,
      column: 0,
      degrees: 0,
      displayDegrees: "000°",
      accessibleLabel: "000° Up",
      label: "Up",
    });
    expect(getLookDirectionCell(1)).toMatchObject({
      degrees: 22.5,
      displayDegrees: "022.5°",
    });
    expect(getLookDirectionCell(4)).toMatchObject({
      row: 9,
      column: 4,
      degrees: 90,
      label: "Right",
    });
    expect(getLookDirectionCell(8)).toMatchObject({
      row: 10,
      column: 0,
      degrees: 180,
      label: "Down",
    });
    expect(getLookDirectionCell(12)).toMatchObject({
      row: 10,
      column: 4,
      degrees: 270,
      label: "Left",
    });
    expect(getLookDirectionCell(15)).toMatchObject({
      row: 10,
      column: 7,
      degrees: 337.5,
      displayDegrees: "337.5°",
      accessibleLabel: "337.5° Up-left",
      label: "Up-left",
    });
    expect(getLookDirectionCell(-1)).toBeNull();
    expect(getLookDirectionCell(16)).toBeNull();
  });

  it("infers only supported sprite versions from exact atlas dimensions", async () => {
    const petTypes = await import("@/lib/pets/types");
    expect("inferSpriteVersionNumber" in petTypes).toBe(true);

    const inferSpriteVersionNumber = (
      petTypes as unknown as {
        inferSpriteVersionNumber: (
          width: number,
          height: number,
        ) => 1 | 2 | null;
      }
    ).inferSpriteVersionNumber;

    expect(inferSpriteVersionNumber(1536, 1872)).toBe(1);
    expect(inferSpriteVersionNumber(1536, 2288)).toBe(2);
    expect(inferSpriteVersionNumber(1536, 2000)).toBeNull();
    expect(inferSpriteVersionNumber(768, 1144)).toBeNull();
  });
});
