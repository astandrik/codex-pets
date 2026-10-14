import { timingSafeEqual } from "node:crypto";
import { createServer } from "node:http";
import { z } from "zod";
import { OPENAI_EMBEDDING_MODEL, OPENAI_EMBEDDING_DIMENSIONS } from "@/lib/pets/openai-embedding-profile";
import type { EmbeddingLedger } from "@/lib/pets/embedding-worker/ledger";

const requestSchema = z.object({ input: z.array(z.string().trim().min(1).max(16_000)).min(1).max(32),
  mode: z.enum(["online", "migration"]) }).strict();
const responseSchema = z.object({ model: z.literal(OPENAI_EMBEDDING_MODEL), data: z.array(z.object({
  index: z.literal(0), embedding: z.array(z.number().finite()).length(OPENAI_EMBEDDING_DIMENSIONS)
    .refine((v) => v.some((x) => Math.abs(x) > 1e-10)),
})).length(1) });

export function createEmbeddingServer(options: {
  token: string;
  ledger: EmbeddingLedger;
  request: (texts: readonly string[]) => Promise<unknown>;
  allowOnline: boolean;
}) {
  const cache = new Map<string, { promise: Promise<unknown>; until: number }>();
  let active = 0;
  let timestamps: number[] = [];
  return createServer(async (request, response) => {
    response.setHeader("Cache-Control", "no-store");
    response.setHeader("Content-Type", "application/json");
    const expected = Buffer.from(`Bearer ${options.token}`);
    const actual = Buffer.from(request.headers.authorization ?? "");
    if (!options.token || expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      response.writeHead(401).end('{"error":"unauthorized"}'); return;
    }
    if (request.url === "/health" && request.method === "GET") {
      response.end(JSON.stringify({ ok: true, model: OPENAI_EMBEDDING_MODEL, migration: options.ledger.summary })); return;
    }
    if (request.url !== "/embeddings" || request.method !== "POST") {
      response.writeHead(404).end('{"error":"not_found"}'); return;
    }
    try {
      let size = 0; const chunks: Buffer[] = [];
      for await (const chunk of request) {
        size += chunk.length;
        if (size > 524_288) { response.writeHead(413).end('{"error":"too_large"}'); return; }
        chunks.push(chunk);
      }
      const parsed = requestSchema.safeParse(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      if (!parsed.success) { response.writeHead(400).end('{"error":"invalid_request"}'); return; }
      const { input, mode } = parsed.data;
      if (mode === "migration") { response.end(JSON.stringify(await options.ledger.embed(input))); return; }
      if (!options.allowOnline || input.length !== 1) { response.writeHead(403).end('{"error":"online_disabled"}'); return; }
      const now = Date.now();
      const key = input[0];
      let cached = cache.get(key);
      if (cached && cached.until <= now) { cache.delete(key); cached = undefined; }
      if (!cached) {
        timestamps = timestamps.filter((t) => now - t < 60_000);
        if (active >= 2 || timestamps.length >= 60) { response.writeHead(429).end('{"error":"rate_limited"}'); return; }
        timestamps.push(now); active++;
        const promise = Promise.resolve().then(() => options.request(input))
          .then((value) => responseSchema.parse(value)).finally(() => { active--; });
        // Failed requests are also cached briefly: concurrent/replayed HTTP requests never retry a paid call automatically.
        cached = { promise, until: now + 600_000 }; cache.set(key, cached);
        while (cache.size > 500) { const oldest = cache.keys().next().value; if (oldest === undefined) break; cache.delete(oldest); }
      }
      response.end(JSON.stringify(await cached.promise));
    } catch {
      // Provider errors may contain request text or credentials. Only a stable classification leaves this boundary.
      response.writeHead(503).end('{"error":"embedding_unavailable"}');
    }
  });
}
