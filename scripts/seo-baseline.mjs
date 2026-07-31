#!/usr/bin/env node
// Technical slice of the fixed SEO measurement cohort.
// Rerun protocol: node scripts/seo-baseline.mjs
// The cohort is frozen; change it only deliberately and update docs/seo-indexation-baseline.md
// (local working file, intentionally not tracked in git).

import https from "node:https";
import { mkdirSync, writeFileSync } from "node:fs";
import { gunzipSync, inflateSync } from "node:zlib";
import { performance } from "node:perf_hooks";
import { join } from "node:path";

const COHORT = [
  "https://pets.ydb-qdrant.tech/",
  "https://pets.ydb-qdrant.tech/?page=2",
  "https://pets.ydb-qdrant.tech/about",
  "https://pets.ydb-qdrant.tech/guides/best-codex-pets-for-ai-coding-agents",
  "https://pets.ydb-qdrant.tech/guides/codex-pets-vs-vscode-pets",
  "https://pets.ydb-qdrant.tech/guides/codex-pets-vs-openpets",
  "https://pets.ydb-qdrant.tech/guides/codex-pets-mcp-integration-guide",
  "https://pets.ydb-qdrant.tech/pets/crawlstack-polished",
  "https://pets.ydb-qdrant.tech/pets/kitsune-chibi-2",
  "https://pets.ydb-qdrant.tech/pets/wild-boar",
  "https://pets.ydb-qdrant.tech/pets/kesha",
  "https://pets.ydb-qdrant.tech/users/astandrik",
  "https://pets.ydb-qdrant.tech/?tags=anime",
];

const TIMEOUT_MS = 30_000;
const MAX_REDIRECTS = 5;

function fetchUrl(url, redirectsLeft = MAX_REDIRECTS) {
  return new Promise((resolve, reject) => {
    const startedAt = performance.now();
    const requestedAt = new Date().toISOString();
    const req = https.get(
      url,
      {
        headers: {
          "Accept-Encoding": "gzip",
          "User-Agent": "codex-pets-seo-baseline/1.0",
          Accept: "text/html,application/xhtml+xml",
        },
      },
      (res) => {
        const ttfbMs = Math.round(performance.now() - startedAt);
        const status = res.statusCode ?? 0;
        if (
          status >= 300 &&
          status < 400 &&
          res.headers.location &&
          redirectsLeft > 0
        ) {
          res.resume();
          const next = new URL(res.headers.location, url).toString();
          resolve(
            fetchUrl(next, redirectsLeft - 1).then((r) => ({
              ...r,
              redirectChain: [...(r.redirectChain ?? []), url],
            })),
          );
          return;
        }
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          const raw = Buffer.concat(chunks);
          const encoding = res.headers["content-encoding"];
          let html = "";
          try {
            if (encoding === "gzip") {
              html = gunzipSync(raw).toString("utf8");
            } else if (encoding === "deflate") {
              html = inflateSync(raw).toString("utf8");
            } else {
              html = raw.toString("utf8");
            }
          } catch {
            html = "";
          }
          resolve({
            requestedUrl: url,
            finalUrl: url,
            requestedAt,
            status,
            ttfbMs,
            gzipBytes: raw.length,
            contentEncoding: encoding ?? "identity",
            xRobotsTag: res.headers["x-robots-tag"] ?? null,
            html,
          });
        });
        res.on("error", reject);
      },
    );
    req.setTimeout(TIMEOUT_MS, () => req.destroy(new Error("timeout")));
    req.on("error", reject);
  });
}

function extract(html, tagRegex, attrRegex) {
  const tag = html.match(tagRegex);
  if (!tag) return null;
  const attr = tag[0].match(attrRegex);
  return attr ? attr[1] : null;
}

function parseHtmlSignals(html) {
  const canonical = extract(
    html,
    /<link\b[^>]*rel="canonical"[^>]*>/i,
    /href="([^"]*)"/i,
  );
  const metaRobots = extract(
    html,
    /<meta\b[^>]*name="robots"[^>]*>/i,
    /content="([^"]*)"/i,
  );
  return { canonical, metaRobots };
}

async function main() {
  const runStartedAt = new Date();
  const stamp = runStartedAt.toISOString().replace(/[:.]/g, "-");
  const outDir = join(process.cwd(), ".scratch", "seo-baseline", stamp);
  mkdirSync(outDir, { recursive: true });

  const rows = [];
  for (const url of COHORT) {
    try {
      const res = await fetchUrl(url);
      const { canonical, metaRobots } = parseHtmlSignals(res.html);
      rows.push({
        url: res.requestedUrl,
        finalUrl: res.finalUrl,
        redirectChain: res.redirectChain ?? [],
        requestedAt: res.requestedAt,
        status: res.status,
        ttfbMs: res.ttfbMs,
        gzipBytes: res.gzipBytes,
        contentEncoding: res.contentEncoding,
        canonical,
        metaRobots,
        xRobotsTag: res.xRobotsTag,
      });
      console.log(`${res.status} ${res.ttfbMs}ms ${res.gzipBytes}B ${url}`);
    } catch (error) {
      rows.push({
        url,
        requestedAt: new Date().toISOString(),
        error: String(error?.message ?? error),
      });
      console.log(`ERR  ${url}: ${error?.message ?? error}`);
    }
  }

  const json = {
    runStartedAt: runStartedAt.toISOString(),
    host: "https://pets.ydb-qdrant.tech",
    cohortSize: COHORT.length,
    rows,
  };
  writeFileSync(join(outDir, "baseline.json"), JSON.stringify(json, null, 2));

  const header =
    "| URL | Status | Canonical | Meta robots | X-Robots-Tag | gzip bytes | TTFB ms | Fetched at (UTC) |\n" +
    "|---|---|---|---|---|---:|---:|---|\n";
  const body = rows
    .map(
      (r) =>
        `| ${r.url} | ${r.status ?? "ERR"} | ${r.canonical ?? "—"} | ${
          r.metaRobots ?? "—"
        } | ${r.xRobotsTag ?? "—"} | ${r.gzipBytes ?? "—"} | ${
          r.ttfbMs ?? "—"
        } | ${r.requestedAt} |`,
    )
    .join("\n");
  writeFileSync(join(outDir, "baseline.md"), header + body + "\n");

  console.log(`\nArtifacts: ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
