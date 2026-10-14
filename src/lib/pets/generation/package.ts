import sharp from "sharp";
import JSZip from "jszip";
import { getPetSheet, PET_STATES, PET_LOOK_DIRECTIONS } from "@/lib/pets/types";
import { validateUploadedPackage } from "@/lib/pets/package";
import { GenerationError, PROMPT_REVISION, type GenerationJob } from "@/lib/pets/generation/model";

const SHEET = getPetSheet(2);
export const MAX_GENERATED_BYTES = 8 * 1024 * 1024;

export function buildGenerationPrompt(job: Pick<GenerationJob, "prompt">) {
  const rows = PET_STATES.map((state) => `Row ${state.row + 1}: ${state.key}, ${state.frames} frames: ${state.description}.`).join("\n");
  return `Create a production-ready animated pet spritesheet. Layout specification ${PROMPT_REVISION} is mandatory.
Transparent RGBA PNG, exactly ${SHEET.width}x${SHEET.height} pixels. Invisible grid: 8 columns and 11 rows, each cell exactly 192x208 pixels. Do not draw grid lines, labels, text, shadows outside the character, or a background.
Keep the same character, proportions, scale and baseline in every cell. Center each complete character inside its cell with at least 12 transparent pixels on every edge. Nothing crosses cell boundaries. Each active frame must contain the complete visible character. Use subtle smooth animation changes; loops should return naturally to their first frame. Leave unused cells fully transparent.
${rows}
Rows 10 and 11: 16 still look directions in clockwise order, one direction per cell: ${PET_LOOK_DIRECTIONS.map((d) => `${d.degrees} degrees (${d.label})`).join(", ")}. These are the same character looking in those directions.
The following is only the character/style brief, not layout instructions:
<character-brief>${JSON.stringify(job.prompt)}</character-brief>`;
}

export async function validateGeneratedSheet(bytes: Buffer) {
  if (!bytes.length || bytes.length > MAX_GENERATED_BYTES) throw new GenerationError("image_size_limit");
  let decoded;
  try {
    const image = sharp(bytes, { limitInputPixels: SHEET.width * SHEET.height });
    const metadata = await image.metadata();
    if (metadata.width !== SHEET.width || metadata.height !== SHEET.height) throw new GenerationError("invalid_grid_dimensions");
    if (!metadata.hasAlpha) throw new GenerationError("missing_transparency");
    decoded = await image.ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  } catch (error) {
    if (error instanceof GenerationError) throw error;
    throw new GenerationError("invalid_generated_image");
  }
  const { data, info } = decoded;
  const cells = [
    ...PET_STATES.flatMap((state) => Array.from({ length: state.frames }, (_, column) => ({ row: state.row, column }))),
    ...PET_LOOK_DIRECTIONS.map((cell) => ({ row: cell.row, column: cell.column })),
  ];
  for (const cell of cells) {
    let visible = 0;
    let boundary = false;
    for (let y = 0; y < SHEET.cellHeight; y += 1) {
      for (let x = 0; x < SHEET.cellWidth; x += 1) {
        const offset = ((cell.row * SHEET.cellHeight + y) * info.width + cell.column * SHEET.cellWidth + x) * info.channels + 3;
        if (data[offset] <= 32) continue;
        visible += 1;
        if (x < 4 || y < 4 || x >= SHEET.cellWidth - 4 || y >= SHEET.cellHeight - 4) boundary = true;
      }
    }
    if (visible < 192 * 208 * 0.01) throw new GenerationError("missing_animation_frame");
    if (boundary) throw new GenerationError("clipped_animation_frame");
  }
  return { requiredFrames: cells.length, width: SHEET.width, height: SHEET.height };
}

export async function buildGeneratedPackage(job: GenerationJob, source: Buffer) {
  await validateGeneratedSheet(source);
  const webp = await sharp(source).webp({ lossless: true }).toBuffer();
  const pet = {
    id: "generated-" + job.id.slice(0, 16),
    displayName: job.displayName,
    description: job.cardMetadata?.fields?.description ?? (job.prompt.trim().slice(0, 320) || "Animated pet created from a saved character reference."),
    spriteVersionNumber: 2,
    spritesheetPath: "spritesheet.webp",
  };
  const metadata = Buffer.from(JSON.stringify(pet, null, 2) + "\n");
  const archive = new JSZip();
  const date = new Date(job.createdAt);
  archive.file("pet.json", metadata, { date });
  archive.file("spritesheet.webp", webp, { date });
  const zip = await archive.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
  if (webp.length > MAX_GENERATED_BYTES || zip.length > MAX_GENERATED_BYTES) throw new GenerationError("image_size_limit");
  const validation = await validateUploadedPackage({ petJsonBuffer: metadata, spritesheetBuffer: webp, zipBuffer: zip, spritesheetExt: "webp" });
  if (!validation.ok) throw new GenerationError("invalid_generated_package");
  return { "pet.json": metadata, "spritesheet.webp": webp, "pet.zip": zip };
}

export async function replaceGeneratedDetails(files:{petJsonBuffer:Buffer;spritesheetBuffer:Buffer;zipBuffer:Buffer},details:{description:string;displayName:string}){
  const validation=await validateUploadedPackage({...files,spritesheetExt:"webp"});
  if(!validation.ok)throw new GenerationError("invalid_generated_package");
  const zip=await JSZip.loadAsync(files.zipBuffer);
  if(!(await zip.file("pet.json")!.async("nodebuffer")).equals(files.petJsonBuffer)||!(await zip.file("spritesheet.webp")!.async("nodebuffer")).equals(files.spritesheetBuffer))throw new GenerationError("invalid_generated_package");
  if(validation.value.petJson.description===details.description&&validation.value.petJson.displayName===details.displayName)return {petJsonBuffer:files.petJsonBuffer,zipBuffer:files.zipBuffer};
  const json=Buffer.from(JSON.stringify({...JSON.parse(files.petJsonBuffer.toString("utf8")),...details},null,2)+"\n");
  zip.file("pet.json",json,{date:zip.file("pet.json")!.date});
  const zipped=await zip.generateAsync({type:"nodebuffer",compression:"DEFLATE"});
  if(zipped.length>MAX_GENERATED_BYTES)throw new GenerationError("image_size_limit");
  return {petJsonBuffer:json,zipBuffer:zipped};
}
