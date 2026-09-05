import { spawn } from "node:child_process";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { JSDOM } from "jsdom";

const repositoryRoot = fileURLToPath(new URL("..", import.meta.url));
const expectedOrigin = "https://pets.example/codex-pets";
const expectedOriginUrl = new URL(expectedOrigin);
const basePath = "/codex-pets";
const suffix = `${Date.now()}-${process.pid}`;
const image = `codex-pets-public-origin-smoke:${suffix}`;
const container = `codex-pets-public-origin-smoke-${suffix}`;
const maxCapturedLines = 80;

const endpoints = [
  { label: "pet Markdown", path: "/pets/orbit-otter/markdown" },
  { label: "generic Markdown", path: "/about.md" },
  { label: "llms.txt", path: "/llms.txt" },
  { label: "manifest", path: "/api/manifest" },
  { label: "OpenAPI", path: "/openapi.json" },
  {
    label: "MCP server card",
    path: "/.well-known/mcp/server-card.json",
  },
  { label: "robots", path: "/robots.txt" },
  { label: "sitemap", path: "/sitemap.xml" },
  { label: "HTML metadata", path: "/pets/orbit-otter", html: true },
];

class CommandError extends Error {
  constructor(message, output) {
    super(message);
    this.output = output;
  }
}

function keepTail(current, chunk) {
  return `${current}${chunk}`.split("\n").slice(-maxCapturedLines).join("\n");
}

function run(command, args, { allowFailure = false, timeoutMs } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: repositoryRoot,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    const timeout = timeoutMs
      ? setTimeout(() => {
          if (child.exitCode === null && child.signalCode === null) {
            timedOut = true;
            child.kill("SIGKILL");
          }
        }, timeoutMs)
      : undefined;

    child.stdout.on("data", (chunk) => {
      stdout = keepTail(stdout, chunk.toString());
    });
    child.stderr.on("data", (chunk) => {
      stderr = keepTail(stderr, chunk.toString());
    });
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (exitCode) => {
      clearTimeout(timeout);
      const output = keepTail(stdout, stderr);
      if (timedOut) {
        reject(
          new CommandError(
            `${command} timed out after ${timeoutMs} ms.`,
            output,
          ),
        );
        return;
      }
      if (exitCode === 0 || allowFailure) {
        resolve({ exitCode, stdout, stderr, output });
        return;
      }
      reject(
        new CommandError(`${command} failed with exit code ${exitCode}.`, output),
      );
    });
  });
}

function sanitizeLog(output) {
  return output
    .split("\n")
    .slice(-40)
    .map((line) =>
      /(?:PASSWORD|SECRET|TOKEN|API_KEY)=/i.test(line)
        ? "[redacted environment line]"
        : line.replace(/(https?:\/\/)[^\s/@]+:[^\s/@]+@/g, "$1[redacted]@"),
    )
    .join("\n")
    .trim();
}

function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

function isExpectedPublicUrl(value) {
  try {
    const url = new URL(value);
    if (url.origin !== expectedOriginUrl.origin) {
      return false;
    }

    return url.pathname === basePath || url.pathname.startsWith(`${basePath}/`);
  } catch {
    return false;
  }
}

function containsExpectedPublicUrl(value) {
  return Array.from(value.matchAll(/https?:\/\/[^\s"'<>()[\]{}]+/g)).some(
    (match) =>
      isExpectedPublicUrl(match[0].replace(/[.,;:!?]+$/g, "")),
  );
}

function verifyLinkHeader(linkHeader, label) {
  for (const match of linkHeader.matchAll(/<([^>]+)>/g)) {
    const target = match[1];
    if (target.startsWith("http://") || target.startsWith("https://")) {
      assert(
        isExpectedPublicUrl(target),
        `${label} Link header contains an unexpected absolute origin.`,
      );
      continue;
    }

    if (target.startsWith("/")) {
      assert(
        target === basePath || target.startsWith(`${basePath}/`),
        `${label} Link header contains a URL outside the expected base path.`,
      );
    }
  }
}

async function waitForServer(localOrigin) {
  const deadline = Date.now() + 60_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`${localOrigin}${basePath}/robots.txt`, {
        signal: AbortSignal.timeout(2_000),
      });
      if (response.ok) {
        return;
      }
    } catch {
      // The container may still be starting.
    }
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 500));
  }

  throw new Error("Docker smoke server did not become ready within 60 seconds.");
}

export function verifyHtmlMetadata(body, expectedUrl) {
  const document = JSDOM.fragment(body);
  assert(
    document.querySelector('link[rel="canonical"]')?.getAttribute("href") === expectedUrl,
    "HTML canonical metadata does not use the expected pet URL.",
  );
  assert(
    document.querySelector('meta[property="og:url"]')?.getAttribute("content") === expectedUrl,
    "HTML OpenGraph metadata does not use the expected pet URL.",
  );
  assert(
    document.querySelector('script[type="application/ld+json"]'),
    "HTML JSON-LD metadata is missing.",
  );
}

async function verifyEndpoint(localOrigin, endpoint) {
  const response = await fetch(`${localOrigin}${basePath}${endpoint.path}`, {
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  const body = await response.text();
  const linkHeader = response.headers.get("link") ?? "";
  const responseText = `${body}\n${linkHeader}`;

  assert(response.status === 200, `${endpoint.label} returned ${response.status}.`);
  assert(
    !responseText.includes("localhost:3000"),
    `${endpoint.label} contains the forbidden localhost origin.`,
  );
  assert(
    !responseText.includes(localOrigin),
    `${endpoint.label} contains the temporary container origin.`,
  );
  assert(
    containsExpectedPublicUrl(body),
    `${endpoint.label} body does not contain the expected canonical origin.`,
  );
  if (linkHeader) {
    verifyLinkHeader(linkHeader, endpoint.label);
  }

  if (endpoint.html) {
    verifyHtmlMetadata(body, `${expectedOrigin}${endpoint.path}`);
  }
}

async function main() {
  let failureOutput = "";
  let containerCreated = false;

  try {
    console.log(`Building isolated image ${image}...`);
    await run("docker", [
      "build",
      "--build-arg",
      `NEXT_PUBLIC_APP_URL=${expectedOrigin}`,
      "--build-arg",
      `NEXT_PUBLIC_BASE_PATH=${basePath}`,
      "--tag",
      image,
      ".",
    ]);

    await run("docker", [
      "run",
      "--detach",
      "--rm",
      "--name",
      container,
      "--publish",
      "127.0.0.1::3000",
      "--env",
      "CODEX_PETS_DATA_SOURCE=mock",
      "--env",
      "AUTH_MODE=single-user",
      "--env",
      "AUTH_SINGLE_USER_EMAIL=local-admin@example.com",
      image,
    ]);
    containerCreated = true;

    const portResult = await run("docker", ["port", container, "3000/tcp"]);
    const portMatch = portResult.stdout.trim().match(/127\.0\.0\.1:(\d+)$/);
    assert(portMatch, "Docker did not publish the app on a loopback port.");
    const localOrigin = `http://127.0.0.1:${portMatch[1]}`;

    await waitForServer(localOrigin);
    for (const endpoint of endpoints) {
      await verifyEndpoint(localOrigin, endpoint);
    }

    await run("docker", ["rm", "--force", container]);
    containerCreated = false;

    await run("docker", [
      "run",
      "--detach",
      "--name",
      container,
      "--env",
      "NEXT_PUBLIC_APP_URL=https://runtime.example/codex-pets",
      "--env",
      `NEXT_PUBLIC_BASE_PATH=${basePath}`,
      image,
    ]);
    containerCreated = true;

    const runtimeMismatchWait = await run("docker", ["wait", container], {
      timeoutMs: 15_000,
    });
    const runtimeMismatchLogs = await run(
      "docker",
      ["logs", "--tail", "40", container],
      { allowFailure: true },
    );
    const runtimeMismatchExitCode = Number.parseInt(
      runtimeMismatchWait.stdout.trim(),
      10,
    );
    assert(
      Number.isInteger(runtimeMismatchExitCode),
      "Docker wait did not report the runtime-mismatch exit code.",
    );

    failureOutput = keepTail(failureOutput, runtimeMismatchLogs.output);
    assert(
      runtimeMismatchExitCode !== 0,
      "Docker runner accepted public configuration that differs from the build.",
    );
    assert(
      runtimeMismatchLogs.output.includes(
        "must match the Docker image build configuration",
      ),
      "Docker runner did not report the build/runtime configuration mismatch.",
    );
    assert(
      !runtimeMismatchLogs.output.includes("▲ Next.js"),
      "Docker runner started Next.js after a public configuration mismatch.",
    );

    await run("docker", ["rm", "--force", container]);
    containerCreated = false;

    console.log(
      `Verified ${endpoints.length} canonical-origin surfaces and runtime override rejection in ${container}.`,
    );
  } catch (error) {
    if (error instanceof CommandError) {
      failureOutput = error.output;
    }
    if (containerCreated) {
      const logs = await run("docker", ["logs", "--tail", "40", container], {
        allowFailure: true,
      });
      failureOutput = keepTail(failureOutput, logs.output);
    }

    console.error(error instanceof Error ? error.message : "Docker smoke failed.");
    const sanitizedLog = sanitizeLog(failureOutput);
    if (sanitizedLog) {
      console.error("Sanitized failure log:\n" + sanitizedLog);
    }
    process.exitCode = 1;
  } finally {
    await run("docker", ["rm", "--force", container], { allowFailure: true });
    await run("docker", ["image", "rm", "--force", image], {
      allowFailure: true,
    });
  }
}

const isDirectExecution =
  process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectExecution) {
  await main();
}
