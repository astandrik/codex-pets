import {renderToStaticMarkup} from "react-dom/server";
import {expect, it} from "vitest";
import {PetPreviewStyles} from "./PetPreviewStyles";

it("holds CSS strip frames for the same durations as Codex idle", () => {
  const markup = renderToStaticMarkup(<PetPreviewStyles/>);
  const stops = [...markup.matchAll(/([\d.]+)%\{transform:translate3d\(([-\d.]+)%,0,0\)\}/g)];
  expect(stops).toHaveLength(6);
  const expectedStarts = [0, 1680, 2340, 3000, 3840, 4680];
  stops.forEach(([, percent, x], frame) => {
    expect(Number(percent) * 6600 / 100).toBeCloseTo(expectedStarts[frame], 8);
    expect(Number(x)).toBeCloseTo(-frame / 6 * 100, 8);
  });
  expect(markup).toContain("100%{transform:translate3d(0,0,0)}");
});
