export function hexToRgba(hex: string): [number, number, number, number];

export function parseSvgPaths(svg: string): Array<{ d: string; fill: string }>;

export function tracePath(d: string): number[][][];

export function rasterizeSvg(svg: string, size?: number): Uint8Array;

export function scaleRaster(
  raster: Uint8Array,
  fromSize: number,
  toSize: number,
): Uint8Array;

export function encodePng(
  width: number,
  height: number,
  rgba: Uint8Array,
): Buffer;

export function encodeIco(
  entries: Array<{ size: number; png: Buffer }>,
): Buffer;
