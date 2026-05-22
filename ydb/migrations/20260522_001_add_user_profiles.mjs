export async function up({ sdk, execute, withSession }) {
  const { AlterTableDescription, Column, Types, TypedValues } = sdk;

  const table = await withSession((session) => session.describeTable("codex_users"));
  const columns = new Set(table.columns.map((column) => column.name));

  for (const column of [
    ["profile_slug", Types.optional(Types.UTF8)],
    ["bio", Types.optional(Types.UTF8)],
    ["website_url", Types.optional(Types.UTF8)],
  ]) {
    if (columns.has(column[0])) continue;
    await withSession((session) =>
      session.alterTable(
        "codex_users",
        new AlterTableDescription().withAddColumn(
          new Column(column[0], column[1]),
        ),
      ),
    );
  }

  const result = await execute(`
SELECT user_id, email_lower, display_name, profile_slug, bio, website_url
FROM codex_users
ORDER BY created_at ASC
  `);

  const usedSlugs = new Set();
  const rows = result?.resultSets?.[0]?.rows ?? [];
  for (const row of rows) {
    const userId = textAt(row, 0);
    const emailLower = textAt(row, 1);
    const displayName = textAt(row, 2);
    const existingSlug = normalizeProfileSlug(textAt(row, 3));
    const profileSlug =
      existingSlug && !usedSlugs.has(existingSlug)
        ? existingSlug
        : uniqueSlug(
            normalizeProfileSlug(displayName) ??
              normalizeProfileSlug(emailLower.split("@")[0]) ??
              "user",
            usedSlugs,
          );

    usedSlugs.add(profileSlug);

    await execute(
      `
DECLARE $user_id AS Utf8;
DECLARE $profile_slug AS Utf8;
DECLARE $bio AS Utf8;
DECLARE $website_url AS Utf8;

UPDATE codex_users
SET profile_slug = $profile_slug,
    bio = $bio,
    website_url = $website_url
WHERE user_id = $user_id;
      `,
      {
        $user_id: TypedValues.utf8(userId),
        $profile_slug: TypedValues.utf8(profileSlug),
        $bio: TypedValues.utf8(textAt(row, 4)),
        $website_url: TypedValues.utf8(textAt(row, 5)),
      },
    );
  }
}

const RESERVED_PROFILE_SLUGS = new Set([
  "about",
  "admin",
  "agents",
  "api",
  "login",
  "logout",
  "mcp",
  "my-pets",
  "my-requests",
  "pets",
  "profile",
  "register",
  "request",
  "submit",
  "users",
]);

function textAt(row, index) {
  return row.items?.[index]?.textValue ?? "";
}

function normalizeProfileSlug(value) {
  const slug = String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/['`]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40)
    .replace(/-+$/g, "");

  if (!/^[a-z0-9](?:[a-z0-9-]{1,38}[a-z0-9])$/.test(slug)) return null;
  if (RESERVED_PROFILE_SLUGS.has(slug)) return null;
  return slug;
}

function uniqueSlug(base, usedSlugs) {
  const normalizedBase = normalizeProfileSlug(base) ?? "user";
  if (!usedSlugs.has(normalizedBase)) return normalizedBase;

  for (let index = 2; index <= 99; index += 1) {
    const suffix = `-${index}`;
    const candidate = `${normalizedBase.slice(0, 40 - suffix.length)}${suffix}`;
    if (!usedSlugs.has(candidate)) return candidate;
  }

  return `${normalizedBase.slice(0, 31)}-${Math.random().toString(16).slice(2, 10)}`;
}
