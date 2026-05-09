#!/usr/bin/env node
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { scrypt as scryptCallback } from "node:crypto";
import { promisify } from "node:util";

import JSZip from "jszip";
import sharp from "sharp";

const require = createRequire(import.meta.url);
const {
  Driver,
  StaticCredentialsAuthService,
  TypedValues,
  getCredentialsFromEnv,
  getDefaultLogger,
} = require("ydb-sdk");

const scrypt = promisify(scryptCallback);

const TABLES = {
  pets: "codex_pets",
  assets: "codex_pet_assets",
  users: "codex_users",
  reviews: "codex_pet_reviews",
  metrics: "codex_pet_metrics",
};

const SHEET = {
  columns: 8,
  rows: 9,
  cellWidth: 192,
  cellHeight: 208,
  width: 1536,
  height: 1872,
};

const args = new Set(process.argv.slice(2));
const shouldReset = args.has("--reset");
const allowNonLocal = args.has("--allow-non-local") || process.env.ALLOW_NON_LOCAL_SEED === "1";

const endpoint = process.env.YDB_PETS_ENDPOINT?.trim() || "grpc://127.0.0.1:2136";
const database = process.env.YDB_PETS_DATABASE?.trim() || "/local";

if (!allowNonLocal && !isLocalEndpoint(endpoint)) {
  throw new Error(
    `Refusing to seed non-local YDB endpoint ${endpoint}. Pass --allow-non-local to override.`,
  );
}

process.env.YDB_ANONYMOUS_CREDENTIALS ??= "1";
process.env.YDB_ENDPOINT ??= endpoint;
process.env.PASSWORD_PEPPER ??= "dev-password-pepper";

const now = new Date();
const users = [
  {
    userId: "dev-admin@example.com",
    email: "dev-admin@example.com",
    displayName: "Dev Admin",
    role: "admin",
  },
  {
    userId: "dev-owner@example.com",
    email: "dev-owner@example.com",
    displayName: "Dev Owner",
    role: "user",
  },
];

const pets = [
  {
    slug: "orbit-otter",
    id: "dev_pet_orbit_otter",
    assetId: "dev_asset_orbit_otter",
    displayName: "Orbit Otter",
    description: "A compact space helper with calm idle loops and bright review states.",
    kind: "creature",
    tags: ["space", "friendly", "blue"],
    status: "approved",
    owner: users[1],
    color: "#4da3ff",
    accent: "#f8d65b",
    glyph: "OO",
    downloadCount: 37,
    installCount: 18,
    createdDaysAgo: 9,
    approvedDaysAgo: 7,
  },
  {
    slug: "terminal-cube",
    id: "dev_pet_terminal_cube",
    assetId: "dev_asset_terminal_cube",
    displayName: "Terminal Cube",
    description: "A geometric object pet for dense coding sessions and quick status changes.",
    kind: "object",
    tags: ["terminal", "object", "green"],
    status: "approved",
    owner: users[0],
    color: "#55c271",
    accent: "#151617",
    glyph: "TC",
    downloadCount: 22,
    installCount: 11,
    createdDaysAgo: 6,
    approvedDaysAgo: 5,
  },
  {
    slug: "patch-pilot",
    id: "dev_pet_patch_pilot",
    assetId: "dev_asset_patch_pilot",
    displayName: "Patch Pilot",
    description: "A character pet that looks at home around diffs, reviews, and small releases.",
    kind: "character",
    tags: ["review", "pilot", "amber"],
    status: "approved",
    owner: users[1],
    color: "#f59f45",
    accent: "#2f5d62",
    glyph: "PP",
    downloadCount: 14,
    installCount: 8,
    createdDaysAgo: 4,
    approvedDaysAgo: 3,
  },
  {
    slug: "pending-pixel",
    id: "dev_pet_pending_pixel",
    assetId: "dev_asset_pending_pixel",
    displayName: "Pending Pixel",
    description: "A sample pending submission for exercising the moderation queue.",
    kind: "object",
    tags: ["pending", "moderation", "sample"],
    status: "pending",
    owner: users[1],
    color: "#b06ee8",
    accent: "#f5f5f5",
    glyph: "PX",
    downloadCount: 0,
    installCount: 0,
    createdDaysAgo: 1,
  },
  {
    slug: "rejected-spark",
    id: "dev_pet_rejected_spark",
    assetId: "dev_asset_rejected_spark",
    displayName: "Rejected Spark",
    description: "A sample rejected submission with a stored review reason.",
    kind: "creature",
    tags: ["rejected", "sample"],
    status: "rejected",
    owner: users[1],
    color: "#ee5d5d",
    accent: "#2b2f36",
    glyph: "RS",
    rejectionReason: "Demo rejection reason for local moderation testing.",
    downloadCount: 0,
    installCount: 0,
    createdDaysAgo: 2,
    rejectedDaysAgo: 1,
  },
];

const reviews = [
  {
    id: "dev_review_terminal_cube_approved",
    petId: "dev_pet_terminal_cube",
    reviewerId: users[0].userId,
    decision: "approved",
    reason: "",
    createdDaysAgo: 5,
  },
  {
    id: "dev_review_rejected_spark",
    petId: "dev_pet_rejected_spark",
    reviewerId: users[0].userId,
    decision: "rejected",
    reason: "Demo rejection reason for local moderation testing.",
    createdDaysAgo: 1,
  },
];

async function main() {
  const driver = createDriver();
  try {
    const ready = await driver.ready(15_000);
    if (!ready) {
      throw new Error(`YDB driver is not ready for ${endpoint} ${database}.`);
    }

    if (shouldReset) {
      await resetSeedData(driver);
    }

    for (const user of users) {
      await upsertUser(driver, user);
    }

    for (const pet of pets) {
      const asset = await buildAsset(pet);
      await upsertAsset(driver, asset);
      await upsertPet(driver, pet);
      await upsertMetric(driver, pet);
    }

    for (const review of reviews) {
      await upsertReview(driver, review);
    }

    console.log(`Seeded ${pets.length} pets and ${users.length} users into ${database}.`);
    console.log("Demo app-session accounts use password: password123");
    console.log("Admin: dev-admin@example.com");
    console.log("User:  dev-owner@example.com");
  } finally {
    await driver.destroy();
  }
}

function createDriver() {
  return new Driver({
    endpoint,
    database,
    authService: createAuthService(),
    clientOptions: {
      "grpc.max_receive_message_length": 16 * 1024 * 1024,
      "grpc.max_send_message_length": 16 * 1024 * 1024,
    },
    poolSettings: {
      minLimit: 1,
      maxLimit: 4,
      keepAlivePeriod: 30_000,
    },
  });
}

function createAuthService() {
  const user = process.env.YDB_STATIC_CREDENTIALS_USER?.trim();
  if (!user) return getCredentialsFromEnv();

  const password = readPassword();
  if (!password) {
    throw new Error(
      "YDB_STATIC_CREDENTIALS_USER is set, but no password or password file was provided.",
    );
  }

  return new StaticCredentialsAuthService(
    user,
    password,
    process.env.YDB_STATIC_CREDENTIALS_AUTH_ENDPOINT?.trim() || endpoint,
    getDefaultLogger(),
  );
}

function readPassword() {
  const file = process.env.YDB_STATIC_CREDENTIALS_PASSWORD_FILE?.trim();
  if (file) return readFileSync(file, "utf8").replace(/[\r\n]+$/, "");
  const value = process.env.YDB_STATIC_CREDENTIALS_PASSWORD ?? "";
  return value.trim() || undefined;
}

async function withSession(driver, fn) {
  return driver.tableClient.withSessionRetry(fn, 10_000, 3);
}

async function resetSeedData(driver) {
  for (const pet of pets) {
    await deleteByKey(driver, TABLES.metrics, "pet_slug", pet.slug);
    await deleteByKey(driver, TABLES.pets, "slug", pet.slug);
    await deleteByKey(driver, TABLES.assets, "asset_id", pet.assetId);
  }

  for (const review of reviews) {
    await deleteByKey(driver, TABLES.reviews, "id", review.id);
  }

  for (const user of users) {
    await deleteByKey(driver, TABLES.users, "user_id", user.userId);
  }
}

async function deleteByKey(driver, table, column, value) {
  await execute(
    driver,
    `
DECLARE $id AS Utf8;
DELETE FROM ${table}
WHERE ${column} = $id;
    `,
    { $id: TypedValues.utf8(value) },
  );
}

async function upsertUser(driver, user) {
  const timestamp = isoDaysAgo(10);
  await execute(
    driver,
    `
DECLARE $user_id AS Utf8;
DECLARE $email AS Utf8;
DECLARE $email_lower AS Utf8;
DECLARE $password_hash AS Utf8;
DECLARE $display_name AS Utf8;
DECLARE $role AS Utf8;
DECLARE $status AS Utf8;
DECLARE $email_verified_at AS Utf8;
DECLARE $created_at AS Utf8;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${TABLES.users}
(user_id, email, email_lower, password_hash, display_name, role, status, email_verified_at, created_at, updated_at)
VALUES ($user_id, $email, $email_lower, $password_hash, $display_name, $role, $status, $email_verified_at, $created_at, $updated_at);
    `,
    {
      $user_id: TypedValues.utf8(user.userId),
      $email: TypedValues.utf8(user.email),
      $email_lower: TypedValues.utf8(user.email.toLowerCase()),
      $password_hash: TypedValues.utf8(await hashPassword("password123")),
      $display_name: TypedValues.utf8(user.displayName),
      $role: TypedValues.utf8(user.role),
      $status: TypedValues.utf8("active"),
      $email_verified_at: TypedValues.utf8(timestamp),
      $created_at: TypedValues.utf8(timestamp),
      $updated_at: TypedValues.utf8(timestamp),
    },
  );
}

async function upsertAsset(driver, asset) {
  await execute(
    driver,
    `
DECLARE $asset_id AS Utf8;
DECLARE $pet_json_bytes AS String;
DECLARE $spritesheet_bytes AS String;
DECLARE $zip_bytes AS String;
DECLARE $spritesheet_ext AS Utf8;
DECLARE $created_at AS Utf8;

UPSERT INTO ${TABLES.assets}
(asset_id, pet_json_bytes, spritesheet_bytes, zip_bytes, spritesheet_ext, created_at)
VALUES ($asset_id, $pet_json_bytes, $spritesheet_bytes, $zip_bytes, $spritesheet_ext, $created_at);
    `,
    {
      $asset_id: TypedValues.utf8(asset.assetId),
      $pet_json_bytes: TypedValues.bytes(asset.petJsonBuffer),
      $spritesheet_bytes: TypedValues.bytes(asset.spritesheetBuffer),
      $zip_bytes: TypedValues.bytes(asset.zipBuffer),
      $spritesheet_ext: TypedValues.utf8("png"),
      $created_at: TypedValues.utf8(isoDaysAgo(0)),
    },
  );
}

async function upsertPet(driver, pet) {
  const createdAt = isoDaysAgo(pet.createdDaysAgo);
  const approvedAt = pet.approvedDaysAgo ? isoDaysAgo(pet.approvedDaysAgo) : "";
  const rejectedAt = pet.rejectedDaysAgo ? isoDaysAgo(pet.rejectedDaysAgo) : "";
  const updatedAt = approvedAt || rejectedAt || createdAt;

  await execute(
    driver,
    `
DECLARE $slug AS Utf8;
DECLARE $id AS Utf8;
DECLARE $display_name AS Utf8;
DECLARE $description AS Utf8;
DECLARE $spritesheet_url AS Utf8;
DECLARE $pet_json_url AS Utf8;
DECLARE $zip_url AS Utf8;
DECLARE $spritesheet_ext AS Utf8;
DECLARE $kind AS Utf8;
DECLARE $tags_json AS Utf8;
DECLARE $status AS Utf8;
DECLARE $owner_id AS Utf8;
DECLARE $owner_email AS Utf8;
DECLARE $owner_name AS Utf8;
DECLARE $contact_email AS Utf8;
DECLARE $rejection_reason AS Utf8;
DECLARE $created_at AS Utf8;
DECLARE $updated_at AS Utf8;
DECLARE $approved_at AS Utf8;
DECLARE $rejected_at AS Utf8;

UPSERT INTO ${TABLES.pets}
(slug, id, display_name, description, spritesheet_url, pet_json_url, zip_url, spritesheet_ext, kind, tags_json, status, owner_id, owner_email, owner_name, contact_email, rejection_reason, created_at, updated_at, approved_at, rejected_at)
VALUES ($slug, $id, $display_name, $description, $spritesheet_url, $pet_json_url, $zip_url, $spritesheet_ext, $kind, $tags_json, $status, $owner_id, $owner_email, $owner_name, $contact_email, $rejection_reason, $created_at, $updated_at, $approved_at, $rejected_at);
    `,
    {
      $slug: TypedValues.utf8(pet.slug),
      $id: TypedValues.utf8(pet.id),
      $display_name: TypedValues.utf8(pet.displayName),
      $description: TypedValues.utf8(pet.description),
      $spritesheet_url: TypedValues.utf8(`/api/assets/${pet.assetId}/spritesheet.png`),
      $pet_json_url: TypedValues.utf8(`/api/assets/${pet.assetId}/pet.json`),
      $zip_url: TypedValues.utf8(`/api/assets/${pet.assetId}/pet.zip`),
      $spritesheet_ext: TypedValues.utf8("png"),
      $kind: TypedValues.utf8(pet.kind),
      $tags_json: TypedValues.utf8(JSON.stringify(pet.tags)),
      $status: TypedValues.utf8(pet.status),
      $owner_id: TypedValues.utf8(pet.owner.userId),
      $owner_email: TypedValues.utf8(pet.owner.email),
      $owner_name: TypedValues.utf8(pet.owner.displayName),
      $contact_email: TypedValues.utf8(pet.owner.email),
      $rejection_reason: TypedValues.utf8(pet.rejectionReason ?? ""),
      $created_at: TypedValues.utf8(createdAt),
      $updated_at: TypedValues.utf8(updatedAt),
      $approved_at: TypedValues.utf8(approvedAt),
      $rejected_at: TypedValues.utf8(rejectedAt),
    },
  );
}

async function upsertMetric(driver, pet) {
  await execute(
    driver,
    `
DECLARE $pet_slug AS Utf8;
DECLARE $download_count AS Uint32;
DECLARE $install_count AS Uint32;
DECLARE $updated_at AS Utf8;

UPSERT INTO ${TABLES.metrics}
(pet_slug, download_count, install_count, updated_at)
VALUES ($pet_slug, $download_count, $install_count, $updated_at);
    `,
    {
      $pet_slug: TypedValues.utf8(pet.slug),
      $download_count: TypedValues.uint32(pet.downloadCount),
      $install_count: TypedValues.uint32(pet.installCount),
      $updated_at: TypedValues.utf8(isoDaysAgo(0)),
    },
  );
}

async function upsertReview(driver, review) {
  await execute(
    driver,
    `
DECLARE $id AS Utf8;
DECLARE $pet_id AS Utf8;
DECLARE $reviewer_id AS Utf8;
DECLARE $decision AS Utf8;
DECLARE $reason AS Utf8;
DECLARE $created_at AS Utf8;

UPSERT INTO ${TABLES.reviews}
(id, pet_id, reviewer_id, decision, reason, created_at)
VALUES ($id, $pet_id, $reviewer_id, $decision, $reason, $created_at);
    `,
    {
      $id: TypedValues.utf8(review.id),
      $pet_id: TypedValues.utf8(review.petId),
      $reviewer_id: TypedValues.utf8(review.reviewerId),
      $decision: TypedValues.utf8(review.decision),
      $reason: TypedValues.utf8(review.reason),
      $created_at: TypedValues.utf8(isoDaysAgo(review.createdDaysAgo)),
    },
  );
}

async function execute(driver, query, params) {
  return withSession(driver, (session) => session.executeQuery(query, params));
}

async function buildAsset(pet) {
  const petJson = {
    id: pet.slug,
    displayName: pet.displayName,
    description: pet.description,
    spritesheetPath: "spritesheet.png",
  };
  const petJsonBuffer = Buffer.from(`${JSON.stringify(petJson, null, 2)}\n`);
  const spritesheetBuffer = await renderSpritesheet(pet);
  const zip = new JSZip();
  zip.file("pet.json", petJsonBuffer);
  zip.file("spritesheet.png", spritesheetBuffer);

  return {
    assetId: pet.assetId,
    petJsonBuffer,
    spritesheetBuffer,
    zipBuffer: await zip.generateAsync({ type: "nodebuffer" }),
  };
}

async function renderSpritesheet(pet) {
  const cells = [];
  for (let row = 0; row < SHEET.rows; row += 1) {
    for (let col = 0; col < SHEET.columns; col += 1) {
      const x = col * SHEET.cellWidth;
      const y = row * SHEET.cellHeight;
      const pulse = 0.64 + ((row + col) % 4) * 0.08;
      const cy = y + 104 + Math.sin((row + col) / 2) * 10;
      cells.push(`
        <rect x="${x + 10}" y="${y + 10}" width="172" height="188" rx="24" fill="#20252d" opacity="0.94"/>
        <circle cx="${x + 96}" cy="${cy.toFixed(1)}" r="${(52 * pulse).toFixed(1)}" fill="${pet.color}"/>
        <circle cx="${x + 73}" cy="${y + 88}" r="8" fill="${pet.accent}"/>
        <circle cx="${x + 119}" cy="${y + 88}" r="8" fill="${pet.accent}"/>
        <rect x="${x + 58}" y="${y + 132}" width="76" height="12" rx="6" fill="${pet.accent}" opacity="0.75"/>
      `);
    }
  }

  const svg = `
<svg xmlns="http://www.w3.org/2000/svg" width="${SHEET.width}" height="${SHEET.height}" viewBox="0 0 ${SHEET.width} ${SHEET.height}">
  <rect width="100%" height="100%" fill="#111318"/>
  ${cells.join("\n")}
  <text x="48" y="96" fill="#ffffff" font-family="Arial, sans-serif" font-size="54" font-weight="700">${escapeXml(pet.glyph)}</text>
</svg>`;

  return sharp(Buffer.from(svg)).png().toBuffer();
}

async function hashPassword(password) {
  const salt = "devseed000000000000000000000000";
  const peppered = `${password}${process.env.PASSWORD_PEPPER}`;
  const derived = await scrypt(peppered, salt, 64);
  return `scrypt$${salt}$${derived.toString("hex")}`;
}

function isoDaysAgo(days) {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000).toISOString();
}

function isLocalEndpoint(value) {
  const parsed = new URL(value);
  return ["localhost", "127.0.0.1", "::1", "ydb-local"].includes(parsed.hostname);
}

function escapeXml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
