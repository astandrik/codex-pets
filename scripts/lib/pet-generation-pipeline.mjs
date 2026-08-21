import sharp from "sharp";

export const V2_ATLAS = Object.freeze({
  columns: 8, rows: 11, cellWidth: 192, cellHeight: 208, width: 1536, height: 2288,
});
export const STANDARD_ROW_SPECS = Object.freeze([
  ["idle", "calm idle breathing and one blink"],
  ["running-right", "a full running gait toward screen-right"],
  ["running-left", "an independently generated running gait toward screen-left, preserving asymmetric details"],
  ["waving", "a friendly wave and return"],
  ["jumping", "anticipation, lift, apex, landing, and recovery"],
  ["failed", "a readable failed or blocked reaction without injury"],
  ["waiting", "patient waiting with a subtle loop"],
  ["running", "active focused work mostly in place"],
  ["review", "careful reviewing or thinking"],
].map(([key, action], row) => ({ key, action, row })));
const CHROMA = [[0, 255, 0], [255, 0, 255], [0, 255, 255], [0, 0, 255], [255, 255, 0]];

export class PetGenerationPipelineError extends Error {
  constructor(code, message) {
    super(message);
    this.name = "PetGenerationPipelineError";
    this.code = code;
  }
}

export async function generatePetBase({ prompt, referenceImage, provider, invokeImage, onImageValidated }) {
  const inputModeration = await provider.moderate({
    text: prompt,
    ...(referenceImage ? { image: referenceImage } : {}),
  });
  if (inputModeration.flagged) throw new PetGenerationPipelineError(
    "input_moderation_rejected",
    "The generation brief or reference image was rejected by moderation.",
  );
  const result = await (invokeImage ?? ((_stage, value) => provider.generateImage(value)))("base", {
    prompt: `Create one polished full-body Codex desktop pet from this private admin brief: ${prompt}.
      ${referenceImage ? "Preserve the reference identity, silhouette, colors, materials, and asymmetry." : "Invent a distinctive animation-ready identity."}
      One centered neutral three-quarter standing pose, generous margins, no crop, no text, plain neutral background, readable at 192x208.`,
    size: "1024x1024",
    references: referenceImage ? [referenceImage] : [],
  });
  await assertPng(result.image, 1024, 1024, "base");
  if ((await provider.moderate({ image: result.image })).flagged) {
    throw new PetGenerationPipelineError("output_moderation_rejected", "The generated base was rejected by moderation.");
  }
  await onImageValidated?.("base", result.image);
  return result;
}

export async function hatchV2Pet({ prompt, baseImage, provider, invokeImage, invokeReview, onImageValidated }) {
  await assertPng(baseImage, 1024, 1024, "base");
  const call = invokeImage ?? ((_stage, value) => provider.generateImage(value));
  const chroma = await chooseChromaColor(baseImage);
  const background = rgbHex(chroma);
  const artifacts = [];
  const sources = [];
  for (const spec of STANDARD_ROW_SPECS) {
    const result = await call(spec.key, {
      prompt: rowPrompt(prompt, spec.action, background),
      size: "1536x1024",
      references: [baseImage],
    });
    await validateOutput(provider, result.image, 1536, 1024, spec.key);
    await onImageValidated?.(spec.key, result.image);
    sources.push(result.image);
    artifacts.push(sourceArtifact(`source-${spec.key}`, spec.key, result.image));
  }
  const cardinal = await call("cardinal", {
    prompt: cardinalPrompt(prompt, background),
    size: "1024x1024",
    references: [baseImage],
  });
  await validateOutput(provider, cardinal.image, 1024, 1024, "cardinal");
  await onImageValidated?.("cardinal", cardinal.image);
  artifacts.push(sourceArtifact("source-cardinal", "cardinal", cardinal.image));
  const look9 = await call("look-row-9", {
    prompt: lookPrompt(prompt, background, "000, 022.5, 045, 067.5, 090, 112.5, 135, 157.5"),
    size: "1536x1024",
    references: [baseImage, cardinal.image],
  });
  const look10 = await call("look-row-10", {
    prompt: lookPrompt(prompt, background, "180, 202.5, 225, 247.5, 270, 292.5, 315, 337.5"),
    size: "1536x1024",
    references: [baseImage, cardinal.image],
  });
  await validateOutput(provider, look9.image, 1536, 1024, "look-row-9");
  await validateOutput(provider, look10.image, 1536, 1024, "look-row-10");
  await onImageValidated?.("look-row-9", look9.image);
  await onImageValidated?.("look-row-10", look10.image);
  artifacts.push(
    sourceArtifact("source-look-row-9", "look-row-9", look9.image),
    sourceArtifact("source-look-row-10", "look-row-10", look10.image),
  );

  const issues = [];
  const rows = [];
  for (let index = 0; index < sources.length; index += 1) {
    const processed = await processGrid({ buffer: sources[index], columns: 4, rows: 2, chroma, rowIndex: index });
    rows.push(processed.frames);
    issues.push(...processed.issues);
  }
  const cardinals = await processGrid({ buffer: cardinal.image, columns: 2, rows: 2, chroma, rowIndex: null });
  const directions9 = await processGrid({ buffer: look9.image, columns: 4, rows: 2, chroma, rowIndex: 9 });
  const directions10 = await processGrid({ buffer: look10.image, columns: 4, rows: 2, chroma, rowIndex: 10 });
  issues.push(...cardinals.issues, ...directions9.issues, ...directions10.issues);
  rows.push(directions9.frames, directions10.frames);

  const spritesheet = await assembleAtlas(rows);
  const contactSheet = await sharp(spritesheet).png({ compressionLevel: 9 }).toBuffer();
  const directionSheet = await contact([...cardinals.frames, ...directions9.frames, ...directions10.frames], 5, 4);
  const qa = {
    pass: issues.every((issue) => issue.severity !== "error"),
    atlas: V2_ATLAS,
    chroma: background,
    despillPasses: 1,
    standardRows: STANDARD_ROW_SPECS.map(({ key, row }) => ({ key, row, frames: 8 })),
    lookDirections: Array.from({ length: 16 }, (_, index) => ({
      index, row: index < 8 ? 9 : 10, column: index % 8, degrees: index * 22.5,
    })),
    issues,
  };
  artifacts.push(
    { key: "spritesheet", stage: "assembly", fileName: "spritesheet.webp", contentType: "image/webp", buffer: spritesheet },
    { key: "contact-sheet", stage: "assembly", fileName: "contact-sheet.png", contentType: "image/png", buffer: contactSheet },
    { key: "direction-sheet", stage: "assembly", fileName: "direction-sheet.png", contentType: "image/png", buffer: directionSheet },
    { key: "qa", stage: "assembly", fileName: "qa.json", contentType: "application/json; charset=utf-8",
      buffer: Buffer.from(`${JSON.stringify(qa, null, 2)}\n`) },
  );
  for (let row = 0; row < STANDARD_ROW_SPECS.length; row += 1) {
    artifacts.push({
      key: `animation-${STANDARD_ROW_SPECS[row].key}`,
      stage: STANDARD_ROW_SPECS[row].key,
      fileName: `${STANDARD_ROW_SPECS[row].key}.gif`,
      contentType: "image/gif",
      buffer: await animation(rows[row]),
    });
  }
  if (!qa.pass) return { artifacts, qa, review: null, chroma: background };
  const review = await (invokeReview ?? ((value) => provider.review(value)))({ contactSheet, directionSheet });
  return { artifacts, qa, review: review.review, chroma: background };
}

export async function chooseChromaColor(baseImage) {
  const average = (await sharp(baseImage).removeAlpha().stats()).channels.slice(0, 3).map((channel) => channel.mean);
  return [...CHROMA].sort((a, b) => distance(b, average) - distance(a, average))[0];
}

export async function processGrid({ buffer, columns, rows, chroma, rowIndex }) {
  const metadata = await sharp(buffer).metadata();
  if (!metadata.width || !metadata.height || metadata.width % columns || metadata.height % rows) {
    throw new PetGenerationPipelineError("invalid_source_grid", "Source grid cannot be divided into required panels.");
  }
  const panelWidth = metadata.width / columns;
  const panelHeight = metadata.height / rows;
  const keyed = [];
  const issues = [];
  for (let index = 0; index < columns * rows; index += 1) {
    const panel = await sharp(buffer)
      .extract({
        left: index % columns * panelWidth,
        top: Math.floor(index / columns) * panelHeight,
        width: panelWidth,
        height: panelHeight,
      })
      .ensureAlpha().raw().toBuffer({ resolveWithObject: true });
    const result = keyOnce(panel.data, panel.info.width, panel.info.height, chroma);
    if (!result.bounds) issues.push(issue(rowIndex, index, "empty-frame", "error", "No foreground remains after chroma removal."));
    else if (result.bounds.left <= 1 || result.bounds.top <= 1 ||
      result.bounds.right >= panel.info.width - 2 || result.bounds.bottom >= panel.info.height - 2) {
      issues.push(issue(rowIndex, index, "source-clipping", "error", "Foreground touches a source panel edge."));
    }
    keyed.push({ ...result, width: panel.info.width, height: panel.info.height });
  }
  const visible = keyed.filter((item) => item.bounds);
  const maxWidth = Math.max(1, ...visible.map((item) => item.bounds.right - item.bounds.left + 1));
  const maxHeight = Math.max(1, ...visible.map((item) => item.bounds.bottom - item.bounds.top + 1));
  const scale = Math.min((V2_ATLAS.cellWidth - 16) / maxWidth, (V2_ATLAS.cellHeight - 16) / maxHeight);
  const frames = [];
  const centers = [];
  for (let index = 0; index < keyed.length; index += 1) {
    const frame = await fit(keyed[index], scale);
    frames.push(frame.buffer);
    centers.push(frame.centerX);
    if (frame.clipped) issues.push(issue(rowIndex, index, "atlas-clipping", "error", "Foreground touches the final cell edge."));
  }
  const median = [...centers].sort((a, b) => a - b)[Math.floor(centers.length / 2)] ?? 96;
  centers.forEach((center, index) => {
    if (Math.abs(center - median) > 28) issues.push(issue(rowIndex, index, "registration", "warning", "Registration differs from row median."));
  });
  return { frames, issues };
}

export async function assembleAtlas(rows) {
  if (rows.length !== 11 || rows.some((row) => row.length !== 8)) {
    throw new PetGenerationPipelineError("invalid_frame_count", "V2 atlas requires 11 rows of 8 frames.");
  }
  const layers = [];
  for (let row = 0; row < 11; row += 1) for (let column = 0; column < 8; column += 1) {
    layers.push({
      input: rows[row][column],
      raw: { width: 192, height: 208, channels: 4 },
      left: column * 192,
      top: row * 208,
    });
  }
  return sharp({
    create: { width: 1536, height: 2288, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite(layers).webp({ quality: 95, alphaQuality: 100, smartSubsample: true }).toBuffer();
}

function keyOnce(input, width, height, chroma) {
  const data = Buffer.from(input);
  const dominant = chroma.indexOf(Math.max(...chroma));
  let left = width, top = height, right = -1, bottom = -1;
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const offset = (y * width + x) * 4;
    const d = distance([data[offset], data[offset + 1], data[offset + 2]], chroma);
    if (d < 55) data[offset + 3] = 0;
    else if (d < 130) data[offset + 3] = Math.round(data[offset + 3] * (d - 55) / 75);
    if (data[offset + 3] && d < 170) {
      const a = data[offset + (dominant + 1) % 3];
      const b = data[offset + (dominant + 2) % 3];
      data[offset + dominant] = Math.min(data[offset + dominant], Math.max(a, b) + 12);
    }
    if (data[offset + 3] > 16) {
      left = Math.min(left, x); top = Math.min(top, y); right = Math.max(right, x); bottom = Math.max(bottom, y);
    }
  }
  return { data, bounds: right >= left && bottom >= top ? { left, top, right, bottom } : null };
}

async function fit(frame, scale) {
  if (!frame.bounds) return { buffer: Buffer.alloc(192 * 208 * 4), centerX: 96, clipped: false };
  const width = frame.bounds.right - frame.bounds.left + 1;
  const height = frame.bounds.bottom - frame.bounds.top + 1;
  const targetWidth = Math.max(1, Math.round(width * scale));
  const targetHeight = Math.max(1, Math.round(height * scale));
  const cropped = await sharp(frame.data, { raw: { width: frame.width, height: frame.height, channels: 4 } })
    .extract({ left: frame.bounds.left, top: frame.bounds.top, width, height })
    .resize(targetWidth, targetHeight, { fit: "fill", kernel: "lanczos3" }).raw().toBuffer();
  const left = Math.floor((192 - targetWidth) / 2);
  const top = 208 - targetHeight - 8;
  const buffer = await sharp({
    create: { width: 192, height: 208, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } },
  }).composite([{ input: cropped, raw: { width: targetWidth, height: targetHeight, channels: 4 }, left, top }]).raw().toBuffer();
  return { buffer, centerX: left + targetWidth / 2,
    clipped: left <= 0 || top <= 0 || left + targetWidth >= 192 || top + targetHeight >= 208 };
}

async function contact(frames, columns, rows) {
  return sharp({
    create: { width: columns * 192, height: rows * 208, channels: 4, background: { r: 32, g: 34, b: 40, alpha: 1 } },
  }).composite(frames.map((input, index) => ({
    input, raw: { width: 192, height: 208, channels: 4 },
    left: index % columns * 192, top: Math.floor(index / columns) * 208,
  }))).png({ compressionLevel: 9 }).toBuffer();
}
async function animation(frames) {
  return sharp(Buffer.concat(frames), {
    raw: { width: 192, height: 208 * frames.length, channels: 4, pageHeight: 208 },
    animated: true,
  }).gif({ loop: 0, delay: Array(frames.length).fill(120), effort: 7 }).toBuffer();
}
async function validateOutput(provider, image, width, height, stage) {
  await assertPng(image, width, height, stage);
  if ((await provider.moderate({ image })).flagged) {
    throw new PetGenerationPipelineError("output_moderation_rejected", `Generated output for ${stage} was rejected.`);
  }
}
async function assertPng(buffer, width, height, stage) {
  if (!buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) {
    throw new PetGenerationPipelineError("invalid_generated_image", `${stage} is not PNG.`);
  }
  const metadata = await sharp(buffer).metadata();
  if (metadata.width !== width || metadata.height !== height) {
    throw new PetGenerationPipelineError("invalid_generated_dimensions", `${stage} must be ${width}x${height}.`);
  }
}
function rowPrompt(brief, action, chroma) {
  return `Use the approved base as exact identity. Create a 4x2 grid of exactly eight sequential frames of ${action}. Brief: ${brief}.
    Preserve identity, scale, floor line and asymmetry. Full body, margins, no text/borders/shadows, flat solid ${chroma} background. Read left-to-right top-to-bottom.`;
}
function cardinalPrompt(brief, chroma) {
  return `Use the approved base as exact identity. Create a 2x2 grid for ${brief}: top-left 000 facing away/up,
    top-right 090 screen-right, bottom-left 180 forward/down, bottom-right 270 screen-left.
    Preserve asymmetry, scale and floor line. Full body, no text/borders, flat ${chroma} background.`;
}
function lookPrompt(brief, chroma, degrees) {
  return `Use the approved base and cardinal grid. Create a 4x2 grid for ${brief}, left-to-right top-to-bottom,
    at exactly ${degrees} degrees. Interpolate without mirroring asymmetry. Consistent scale and floor line,
    full body, no text/borders, flat ${chroma} background.`;
}
function sourceArtifact(key, stage, buffer) {
  return { key, stage, fileName: `${key}.png`, contentType: "image/png", buffer };
}
function issue(row, frame, category, severity, message) {
  return { row, frame, category, severity, message };
}
function distance(a, b) {
  return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2);
}
function rgbHex(rgb) {
  return `#${rgb.map((value) => Math.round(value).toString(16).padStart(2, "0")).join("")}`;
}
