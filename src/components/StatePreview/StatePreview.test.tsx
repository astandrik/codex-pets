import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

const hookValues = vi.hoisted(() => ({ current: [] as unknown[] }));

vi.mock("react", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react")>();
  return {
    ...actual,
    useEffect: () => undefined,
    useMemo: <T,>(factory: () => T) => factory(),
    useState: <T,>(initialValue: T) =>
      [
        (hookValues.current.shift() ?? initialValue) as T,
        () => undefined,
      ] as const,
  };
});

import { StatePreview } from "@/components/StatePreview/StatePreview";

describe("StatePreview", () => {
  it("marks only Look directions active when that preview is selected", () => {
    hookValues.current = ["look-directions", 0, true, 2, 2];

    const html = renderToStaticMarkup(
      StatePreview({
        petJsonUrl: "/pet.json",
        spritesheetUrl: "/spritesheet.webp",
      }),
    );

    expect(html.match(/state-preview__button--active/g)).toHaveLength(1);
    expect(html).toContain(
      'state-preview__button state-preview__button--active"><span>Look directions</span>',
    );
  });
});
