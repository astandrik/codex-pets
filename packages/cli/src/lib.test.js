import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  buildApiUrl,
  findManifestPet,
  installPet,
  listPets,
  parseArgs,
  runCli,
} from "./lib.js";

const tempDirs = [];

afterEach(async () => {
  vi.restoreAllMocks();
  await Promise.all(
    tempDirs.splice(0).map((dir) => fs.rm(dir, { recursive: true, force: true })),
  );
});

describe("codex-pets cli helpers", () => {
  it("parses install options", () => {
    expect(parseArgs(["install", "zero-two-2", "--force", "--url", "https://x.test"])).toEqual({
      command: "install",
      slug: "zero-two-2",
      force: true,
      baseUrl: "https://x.test",
      help: false,
      version: false,
    });
  });

  it("parses mcp options", () => {
    expect(parseArgs(["mcp", "--url", "https://x.test"])).toEqual({
      command: "mcp",
      slug: null,
      force: false,
      baseUrl: "https://x.test",
      help: false,
      version: false,
    });
  });

  it("builds API urls under a base path", () => {
    expect(buildApiUrl("https://pets.test/codex-pets", "/api/manifest")).toBe(
      "https://pets.test/codex-pets/api/manifest",
    );
  });

  it("prints the CLI version", async () => {
    const stdout = vi.fn();

    await runCli(["--version"], { stdout });

    expect(stdout).toHaveBeenCalledWith("1.0.0");
  });

  it("lists manifest pets", async () => {
    const fetchImpl = createFetch({
      "GET https://pets.test/api/manifest": jsonResponse({
        pets: [manifestPet("boba")],
      }),
    });

    await expect(
      listPets({ baseUrl: "https://pets.test", fetchImpl }),
    ).resolves.toEqual([
      {
        slug: "boba",
        displayName: "Boba",
        spritesheetUrl: "/api/assets/a/spritesheet.webp",
        petJsonUrl: "/api/assets/a/pet.json",
      },
    ]);
  });

  it.each([null, [], 3, "pet"])("rejects malformed manifest entries with context: %j", async (entry) => {
    const fetchImpl = createFetch({
      "GET https://pets.test/api/manifest": jsonResponse({ pets: [entry] }),
    });
    await expect(listPets({ baseUrl: "https://pets.test", fetchImpl }))
      .rejects.toThrow("Manifest pet");
  });

  it.each(["a".repeat(49), "a".repeat(64), "legacy-"])("accepts a public lookup slug: %s", (slug) => {
    expect(findManifestPet({ pets: [manifestPet(slug)] }, ` ${slug} `).slug).toBe(slug);
  });

  it.each(["../boba", "a".repeat(65), "", null])("rejects invalid install slugs before HTTP: %j", async (slug) => {
    const fetchImpl = vi.fn();
    await expect(installPet({ slug, codexHome: await makeTempDir(), fetchImpl }))
      .rejects.toThrow("Invalid pet slug");
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([false, true])("preserves the previous pack if publishing fails (rollback fails: %s)", async (rollbackFails) => {
    const codexHome = await makeTempDir();
    const targetDir = path.join(codexHome, "pets", "boba");
    await fs.mkdir(targetDir, { recursive: true });
    await fs.writeFile(path.join(targetDir, "pet.json"), "old");
    const fetchImpl = createFetch({
      "GET https://pets.test/api/manifest": jsonResponse({ pets: [manifestPet("boba")] }),
      "GET https://pets.test/api/assets/a/pet.json": bufferResponse(petJson("spritesheet.webp")),
      "GET https://pets.test/api/assets/a/spritesheet.webp": bufferResponse("new"),
    });
    const rename = fs.rename.bind(fs);
    let attempts = 0;
    vi.spyOn(fs, "rename").mockImplementation(async (from, to) => {
      if (to === targetDir && (++attempts === 1 || rollbackFails)) {
        throw new Error("injected rename failure");
      }
      return rename(from, to);
    });
    let failure;
    try {
      await installPet({ slug: "boba", force: true, baseUrl: "https://pets.test", codexHome, fetchImpl });
    } catch (error) {
      failure = error;
    }
    expect(failure).toBeInstanceOf(Error);
    if (rollbackFails) {
      expect(failure).toBeInstanceOf(AggregateError);
      const staging = (await fs.readdir(path.dirname(targetDir))).find((name) => name.startsWith(".tmp-boba-"));
      const previous = path.join(path.dirname(targetDir), staging, "previous");
      expect(failure.message).toContain(previous);
      expect(await fs.readFile(path.join(previous, "pet.json"), "utf8")).toBe("old");
    } else {
      expect(failure.message).toBe("injected rename failure");
      expect(await fs.readFile(path.join(targetDir, "pet.json"), "utf8")).toBe("old");
      expect(await fs.readdir(path.dirname(targetDir))).toEqual(["boba"]);
    }
    expect(fetchImpl.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  });

  it("installs pet.json and spritesheet from relative manifest urls", async () => {
    const codexHome = await makeTempDir();
    const fetchImpl = createFetch({
      "GET https://pets.test/gallery/api/manifest": jsonResponse({
        pets: [
          {
            ...manifestPet("boba"),
            petJsonUrl: "api/assets/a/pet.json",
            spritesheetUrl: "api/assets/a/spritesheet.webp",
          },
        ],
      }),
      "GET https://pets.test/gallery/api/assets/a/pet.json": bufferResponse(
        petJson("spritesheet.webp"),
      ),
      "GET https://pets.test/gallery/api/assets/a/spritesheet.webp": bufferResponse(
        "sprite-bytes",
      ),
      "POST https://pets.test/gallery/api/pets/boba/install": jsonResponse({ ok: true }),
    });

    const result = await installPet({
      slug: "boba",
      baseUrl: "https://pets.test/gallery",
      codexHome,
      fetchImpl,
    });

    await expect(
      fs.readFile(path.join(codexHome, "pets", "boba", "pet.json"), "utf8"),
    ).resolves.toBe(petJson("spritesheet.webp"));
    await expect(
      fs.readFile(path.join(codexHome, "pets", "boba", "spritesheet.webp"), "utf8"),
    ).resolves.toBe("sprite-bytes");
    expect(result.metricRecorded).toBe(true);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://pets.test/gallery/api/pets/boba/install",
      { method: "POST" },
    );
  });

  it("refuses to replace an existing pet without force", async () => {
    const codexHome = await makeTempDir();
    await fs.mkdir(path.join(codexHome, "pets", "boba"), { recursive: true });
    await fs.writeFile(path.join(codexHome, "pets", "boba", "pet.json"), "old");
    const fetchImpl = createFetch({
      "GET https://pets.test/api/manifest": jsonResponse({
        pets: [manifestPet("boba")],
      }),
    });

    await expect(
      installPet({
        slug: "boba",
        baseUrl: "https://pets.test",
        codexHome,
        fetchImpl,
      }),
    ).rejects.toThrow("--force");
    await expect(
      fs.readFile(path.join(codexHome, "pets", "boba", "pet.json"), "utf8"),
    ).resolves.toBe("old");
  });

  it("replaces an existing pet with force after downloads validate", async () => {
    const codexHome = await makeTempDir();
    const warn = vi.fn();
    await fs.mkdir(path.join(codexHome, "pets", "boba"), { recursive: true });
    await fs.writeFile(path.join(codexHome, "pets", "boba", "pet.json"), "old");
    const fetchImpl = createFetch({
      "GET https://pets.test/api/manifest": jsonResponse({
        pets: [manifestPet("boba")],
      }),
      "GET https://pets.test/api/assets/a/pet.json": bufferResponse(
        petJson("spritesheet.webp"),
      ),
      "GET https://pets.test/api/assets/a/spritesheet.webp": bufferResponse("new"),
      "POST https://pets.test/api/pets/boba/install": jsonResponse(
        { error: "down" },
        503,
      ),
    });

    const result = await installPet({
      slug: "boba",
      baseUrl: "https://pets.test",
      codexHome,
      fetchImpl,
      force: true,
      warn,
    });

    await expect(
      fs.readFile(path.join(codexHome, "pets", "boba", "spritesheet.webp"), "utf8"),
    ).resolves.toBe("new");
    expect(await fs.readdir(path.join(codexHome, "pets"))).toEqual(["boba"]);
    expect(result.metricRecorded).toBe(false);
    expect(warn).toHaveBeenCalledWith(expect.stringContaining("metrics"));
  });

  it("fails when the slug is missing from the manifest", async () => {
    const codexHome = await makeTempDir();
    const fetchImpl = createFetch({
      "GET https://pets.test/api/manifest": jsonResponse({ pets: [] }),
    });

    await expect(
      installPet({
        slug: "missing",
        baseUrl: "https://pets.test",
        codexHome,
        fetchImpl,
      }),
    ).rejects.toThrow("Pet not found");
  });

  it("fails on malformed manifests", async () => {
    const fetchImpl = createFetch({
      "GET https://pets.test/api/manifest": jsonResponse({ pets: {} }),
    });

    await expect(
      listPets({ baseUrl: "https://pets.test", fetchImpl }),
    ).rejects.toThrow("pets array");
  });

  it("does not install when pet.json points at a different spritesheet", async () => {
    const codexHome = await makeTempDir();
    const fetchImpl = createFetch({
      "GET https://pets.test/api/manifest": jsonResponse({
        pets: [manifestPet("boba")],
      }),
      "GET https://pets.test/api/assets/a/pet.json": bufferResponse(
        petJson("spritesheet.png"),
      ),
      "GET https://pets.test/api/assets/a/spritesheet.webp": bufferResponse("new"),
    });

    await expect(
      installPet({
        slug: "boba",
        baseUrl: "https://pets.test",
        codexHome,
        fetchImpl,
      }),
    ).rejects.toThrow("spritesheetPath");
    await expect(pathExists(path.join(codexHome, "pets", "boba"))).resolves.toBe(
      false,
    );
  });
});

function manifestPet(slug) {
  return {
    slug,
    displayName: "Boba",
    spritesheetUrl: "/api/assets/a/spritesheet.webp",
    petJsonUrl: "/api/assets/a/pet.json",
  };
}

function petJson(spritesheetPath) {
  return `${JSON.stringify({
    id: "boba",
    displayName: "Boba",
    description: "Demo pet",
    spritesheetPath,
  })}\n`;
}

async function makeTempDir() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "codex-pets-cli-"));
  tempDirs.push(dir);
  return dir;
}

function createFetch(routes) {
  return vi.fn(async (url, init = {}) => {
    const method = init.method ?? "GET";
    const response = routes[`${method} ${String(url)}`];
    if (!response) return jsonResponse({ error: "not_found" }, 404);
    return response;
  });
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    arrayBuffer: async () => bufferToArrayBuffer(Buffer.from(JSON.stringify(body))),
  };
}

function bufferResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    arrayBuffer: async () => bufferToArrayBuffer(Buffer.from(body)),
    json: async () => JSON.parse(body),
  };
}

function bufferToArrayBuffer(buffer) {
  return buffer.buffer.slice(
    buffer.byteOffset,
    buffer.byteOffset + buffer.byteLength,
  );
}

async function pathExists(value) {
  try {
    await fs.access(value);
    return true;
  } catch {
    return false;
  }
}
