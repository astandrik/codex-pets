import { describe, expect, it } from "vitest";

import { getPageViewTransition } from "@/app/YandexMetrika";

describe("Yandex Metrika route transitions", () => {
  it("skips the initial client route effect", () => {
    expect(
      getPageViewTransition(null, "https://pets.example/gallery"),
    ).toBeNull();
  });

  it("skips a repeated full URL", () => {
    expect(
      getPageViewTransition(
        "https://pets.example/gallery?tag=otter",
        "https://pets.example/gallery?tag=otter",
      ),
    ).toBeNull();
  });

  it("returns the previous full URL as referer for a distinct URL", () => {
    expect(
      getPageViewTransition(
        "https://pets.example/gallery?tag=otter",
        "https://pets.example/gallery?tag=fox",
      ),
    ).toEqual({
      referer: "https://pets.example/gallery?tag=otter",
      url: "https://pets.example/gallery?tag=fox",
    });
  });
});
