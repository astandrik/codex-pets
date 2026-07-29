#!/usr/bin/env node
/**
 * Generates binary brand icons from public/favicon.svg (16x16 pixel art):
 *   - src/app/favicon.ico            (16x16 + 32x32, PNG-in-ICO)
 *   - public/assets/brand-icon-192.png
 *   - public/assets/brand-icon-512.png
 *
 * Zero dependencies: PNG encoding uses node:zlib, ICO is a trivial container.
 * Run: node scripts/generate-brand-icons.mjs
 */

import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { deflateSync } from "node:zlib";

const SVG_SIZE = 16;

export function hexToRgba(hex) {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255, 255];
}

export function parseSvgPaths(svg) {
  const paths = [];
  const pathTagPattern = /<path\b[^>]*>/g;
  let tag;
  while ((tag = pathTagPattern.exec(svg)) !== null) {
    const d = /\bd="([^"]+)"/.exec(tag[0])?.[1];
    const fill = /\bfill="([^"]+)"/.exec(tag[0])?.[1];
    if (d && fill) {
      paths.push({ d, fill });
    }
  }
  return paths;
}

export function tracePath(d) {
  const commands = d.match(/[A-Za-z][^A-Za-z]*/g) ?? [];
  const subpaths = [];
  let current = null;
  let x = 0;
  let y = 0;
  let startX = 0;
  let startY = 0;

  for (const command of commands) {
    const op = command[0];
    const numbers = command
      .slice(1)
      .trim()
      .split(/[\s,]+/)
      .filter(Boolean)
      .map(Number);

    switch (op) {
      case "M":
        [x, y] = numbers;
        startX = x;
        startY = y;
        current = [[x, y]];
        subpaths.push(current);
        break;
      case "m":
        // A leading relative moveto is absolute per the SVG spec.
        if (current === null) {
          [x, y] = numbers;
        } else {
          x += numbers[0];
          y += numbers[1];
        }
        startX = x;
        startY = y;
        current = [[x, y]];
        subpaths.push(current);
        break;
      case "H":
        [x] = numbers;
        current.push([x, y]);
        break;
      case "h":
        x += numbers[0];
        current.push([x, y]);
        break;
      case "V":
        [y] = numbers;
        current.push([x, y]);
        break;
      case "v":
        y += numbers[0];
        current.push([x, y]);
        break;
      case "Z":
      case "z":
        current.push([startX, startY]);
        x = startX;
        y = startY;
        break;
      default:
        throw new Error(`Unsupported path command: ${op}`);
    }
  }

  return subpaths;
}

function pointInSubpaths(subpaths, px, py) {
  let inside = false;
  for (const polygon of subpaths) {
    for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
      const [xi, yi] = polygon[i];
      const [xj, yj] = polygon[j];
      const crossesRay = yi > py !== yj > py;
      if (crossesRay && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) {
        inside = !inside;
      }
    }
  }
  return inside;
}

export function rasterizeSvg(svg, size = SVG_SIZE) {
  const raster = new Uint8Array(size * size * 4);
  for (const { d, fill } of parseSvgPaths(svg)) {
    const subpaths = tracePath(d);
    const [r, g, b, a] = hexToRgba(fill);
    for (let py = 0; py < size; py++) {
      for (let px = 0; px < size; px++) {
        if (pointInSubpaths(subpaths, px + 0.5, py + 0.5)) {
          const offset = (py * size + px) * 4;
          raster[offset] = r;
          raster[offset + 1] = g;
          raster[offset + 2] = b;
          raster[offset + 3] = a;
        }
      }
    }
  }
  return raster;
}

export function scaleRaster(raster, fromSize, toSize) {
  const scaled = new Uint8Array(toSize * toSize * 4);
  const ratio = fromSize / toSize;
  for (let y = 0; y < toSize; y++) {
    for (let x = 0; x < toSize; x++) {
      const sourceX = Math.floor((x + 0.5) * ratio);
      const sourceY = Math.floor((y + 0.5) * ratio);
      const sourceOffset = (sourceY * fromSize + sourceX) * 4;
      scaled.set(raster.subarray(sourceOffset, sourceOffset + 4), (y * toSize + x) * 4);
    }
  }
  return scaled;
}

const CRC_TABLE = (() => {
  const table = new Int32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    table[n] = c;
  }
  return table;
})();

function crc32(buffer) {
  let c = 0xffffffff;
  for (const byte of buffer) {
    c = CRC_TABLE[(c ^ byte) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function pngChunk(type, data) {
  const chunk = Buffer.alloc(12 + data.length);
  chunk.writeUInt32BE(data.length, 0);
  chunk.write(type, 4, "ascii");
  data.copy(chunk, 8);
  chunk.writeUInt32BE(crc32(chunk.subarray(4, 8 + data.length)), 8 + data.length);
  return chunk;
}

export function encodePng(width, height, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA

  const stride = width * 4 + 1;
  const raw = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    raw[y * stride] = 0; // filter: none
    Buffer.from(rgba.buffer, rgba.byteOffset + y * width * 4, width * 4).copy(
      raw,
      y * stride + 1,
    );
  }

  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    pngChunk("IHDR", ihdr),
    pngChunk("IDAT", deflateSync(raw, { level: 9 })),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

export function encodeIco(entries) {
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2); // type: icon
  header.writeUInt16LE(entries.length, 4);

  const directories = [];
  const images = [];
  let offset = 6 + entries.length * 16;
  for (const { size, png } of entries) {
    const directory = Buffer.alloc(16);
    directory[0] = size >= 256 ? 0 : size;
    directory[1] = size >= 256 ? 0 : size;
    directory[2] = 0; // palette colors
    directory[3] = 0; // reserved
    directory.writeUInt16LE(1, 4); // color planes
    directory.writeUInt16LE(32, 6); // bits per pixel
    directory.writeUInt32LE(png.length, 8);
    directory.writeUInt32LE(offset, 12);
    directories.push(directory);
    images.push(png);
    offset += png.length;
  }

  return Buffer.concat([header, ...directories, ...images]);
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;

if (isMain) {
  const root = join(dirname(fileURLToPath(import.meta.url)), "..");
  const svg = readFileSync(join(root, "public/favicon.svg"), "utf8");
  const raster16 = rasterizeSvg(svg);

  const ico = encodeIco([
    { size: 16, png: encodePng(16, 16, raster16) },
    { size: 32, png: encodePng(32, 32, scaleRaster(raster16, 16, 32)) },
  ]);
  writeFileSync(join(root, "src/app/favicon.ico"), ico);
  writeFileSync(
    join(root, "public/assets/brand-icon-192.png"),
    encodePng(192, 192, scaleRaster(raster16, 16, 192)),
  );
  writeFileSync(
    join(root, "public/assets/brand-icon-512.png"),
    encodePng(512, 512, scaleRaster(raster16, 16, 512)),
  );
  console.log(
    "Wrote src/app/favicon.ico, public/assets/brand-icon-192.png, public/assets/brand-icon-512.png",
  );
}
