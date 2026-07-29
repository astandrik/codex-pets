import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

const { encodeIco, encodePng, rasterizeSvg, scaleRaster } = await import(
  "./generate-brand-icons.mjs"
);

const faviconSvg = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), "../public/favicon.svg"),
  "utf8",
);

function pixel(raster: Uint8Array, size: number, x: number, y: number) {
  const offset = (y * size + x) * 4;
  return Array.from(raster.subarray(offset, offset + 4));
}

describe("generate-brand-icons", () => {
  it("rasterizes the pixel-art favicon deterministically", () => {
    const raster = rasterizeSvg(faviconSvg);

    // Transparent corner outside the cat silhouette.
    expect(pixel(raster, 16, 0, 0)).toEqual([0, 0, 0, 0]);
    // Orange fill near the top-left ear.
    expect(pixel(raster, 16, 2, 2)).toEqual([0xff, 0xbd, 0x4a, 0xff]);
    // Dark left eye.
    expect(pixel(raster, 16, 5, 8)).toEqual([0x07, 0x0a, 0x11, 0xff]);
    // Darker orange band across the lower body.
    expect(pixel(raster, 16, 7, 12)).toEqual([0xef, 0xa8, 0x32, 0xff]);
  });

  it("upscales with nearest neighbor, keeping sharp pixel edges", () => {
    const raster = rasterizeSvg(faviconSvg);
    const scaled = scaleRaster(raster, 16, 32);

    // Source pixel (2,2) covers the 2x2 block at (4..5, 4..5) in 32px.
    expect(pixel(scaled, 32, 4, 4)).toEqual([0xff, 0xbd, 0x4a, 0xff]);
    expect(pixel(scaled, 32, 5, 5)).toEqual([0xff, 0xbd, 0x4a, 0xff]);
    expect(pixel(scaled, 32, 0, 0)).toEqual([0, 0, 0, 0]);
  });

  it("encodes a valid PNG signature", () => {
    const png = encodePng(16, 16, rasterizeSvg(faviconSvg));

    expect(Array.from(png.subarray(0, 8))).toEqual([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
    ]);
  });

  it("encodes a valid ICO container with two PNG entries", () => {
    const raster = rasterizeSvg(faviconSvg);
    const ico = encodeIco([
      { size: 16, png: encodePng(16, 16, raster) },
      { size: 32, png: encodePng(32, 32, scaleRaster(raster, 16, 32)) },
    ]);

    expect(Array.from(ico.subarray(0, 4))).toEqual([0, 0, 1, 0]);
    expect(ico.readUInt16LE(4)).toBe(2);
    // First directory entry: 16x16, 32bpp.
    expect(ico[6]).toBe(16);
    expect(ico[7]).toBe(16);
    expect(ico.readUInt16LE(12)).toBe(32);
  });
});
