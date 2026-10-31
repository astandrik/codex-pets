import { execFile } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import { PET_STATES } from "@/lib/pets/types";
import { GenerationError, usageSchema, type StageName } from "@/lib/pets/generation/model";
import type { SpriteRenderer } from "@/lib/pets/generation/sprite-worker";

import { cleanupSpriteWorkspaces } from "@/lib/pets/generation/workspace";
import {readFailureDiagnostic, type FailureDiagnostic} from "@/lib/pets/generation/failure-diagnostic";
import {logSpriteHttpDiagnostic} from "@/lib/pets/generation/http-diagnostic";

const execute = promisify(execFile);
const replySchema = z.object({ generationMs: z.number().nonnegative().optional(), usage: usageSchema.nullable().optional(), ok: z.boolean().optional() });
const ERROR_CODES = new Set(["provider_rejected", "provider_rate_limited", "outcome_unknown", "invalid_sprite_extraction", "missing_animation_frame", "invalid_stage"]);
export function parseSpritegenReply(text: string) {
  let input: unknown;
  try { input = JSON.parse(text.trim()); } catch { throw new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"renderer_reply",reason:"invalid_json"}); }
  if (input && typeof input === "object" && "error" in input) {
    const code = String(input.error);
    throw new GenerationError(ERROR_CODES.has(code) ? code : "outcome_unknown", undefined,
      "providerFailure" in input ? input.providerFailure : undefined,undefined,
      "failureDiagnostic" in input ? input.failureDiagnostic : {boundary:"renderer_reply",reason:"unclassified"},
      "cliCause" in input ? input.cliCause : undefined,
      "errorDetails" in input ? input.errorDetails : undefined, "assemblyIssues" in input ? input.assemblyIssues : undefined);
  }
  const parsed = replySchema.safeParse(input);
  if (!parsed.success) throw new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"renderer_reply",reason:"invalid_schema"});
  return parsed.data;
}
export function processFailureDiagnostic(error:unknown,elapsedMs:number):FailureDiagnostic{
  const value=error&&typeof error==="object"?error:{};
  const code="code"in value?value.code:undefined;
  const signal="signal"in value?value.signal:undefined;
  let reason:FailureDiagnostic["reason"]="process_exit";
  if(code==="ERR_CHILD_PROCESS_STDIO_MAXBUFFER")reason="output_buffer_limit";
  else if(code==="ENOENT"||code==="EACCES")reason="process_spawn";
  else if("killed"in value&&value.killed===true&&elapsedMs>=230_000)reason="process_timeout";
  return readFailureDiagnostic({boundary:"renderer_process",reason,
    elapsedMs:Math.min(600_000,Math.max(0,Math.round(elapsedMs))),
    ...(typeof code==="number"&&Number.isInteger(code)&&Math.abs(code)<=255?{exitCode:code}:{}),
    ...(typeof signal==="string"&&["SIGTERM","SIGKILL","SIGSEGV","SIGABRT","SIGBUS"].includes(signal)?{signal}:{}),
  })??{boundary:"renderer_process",reason:"unclassified"};
}
export function spritegenEnvironment(apiKey: string): NodeJS.ProcessEnv {
  const proxy = process.env.PET_GENERATION_PROXY_URL?.trim();
  if (!proxy || !/^http:\/\/(172\.17\.0\.1|host\.docker\.internal):(18089|18090)$/.test(proxy)) throw new GenerationError("proxy_not_configured");
  return { NODE_ENV: "production", PATH: "/usr/local/bin:/usr/bin:/bin", OPENAI_API_KEY: apiKey,
    PET_GENERATION_PROXY_URL: proxy, HTTP_PROXY: proxy, HTTPS_PROXY: proxy, NO_PROXY: "localhost,127.0.0.1",
    PYTHONDONTWRITEBYTECODE: "1", PYTHON_COLORS: "0", SPRITE_GEN_GEN_TIMEOUT_SECONDS: "180" };
}
export const spriteRenderer: SpriteRenderer = {
  async cleanupExpired(now) { await cleanupSpriteWorkspaces(tmpdir(), now); },
  async open(job, saved, reference, revisionAtlas, {diagnosticOnly=false}={}) {
    const needsImages=!diagnosticOnly&&(!job.continuation || job.continuation.generationStages.length>0);
    const keyFile = needsImages?process.env.PET_GENERATION_OPENAI_KEY_FILE?.trim():undefined;
    let key: string;
    try {
      key = keyFile ? readFileSync(keyFile, "utf8").trim() : "";
    } catch {
      throw new GenerationError("provider_not_configured");
    }
    if (needsImages && !key) throw new GenerationError("provider_not_configured");
    const env: NodeJS.ProcessEnv = needsImages ? spritegenEnvironment(key) : {NODE_ENV: "production", PATH: "/usr/local/bin:/usr/bin:/bin", PYTHONDONTWRITEBYTECODE: "1", PYTHON_COLORS: "0"};
    const directory = await mkdtemp(path.join(tmpdir(), "pets-row-worker-"));
    const python = process.env.PET_GENERATION_PYTHON ?? "/usr/local/bin/python3";
    const script = path.resolve("scripts/pet-spritegen/renderer.py");
    try {
      await writeFile(path.join(directory, "workspace.json"), JSON.stringify({ expiresAt: job.expiresAt, pid: process.pid }), { mode: 0o600 });
      const rows = [...PET_STATES.map(state => ({ name: state.key, frames: state.frames, action: state.description, row: state.row })),
        { name: "look-0-157", frames: 8, action: "", row: 9 }, { name: "look-180-337", frames: 8, action: "", row: 10 }];
      await writeFile(path.join(directory, "job.json"), JSON.stringify({ prompt: job.prompt, rows, reviewBase: job.reviewBase === true, hasReference: Boolean(job.reference), animationAnatomyPolicy: job.animationAnatomyPolicy, ...(job.continuation?{continuation:job.continuation}:{}), ...(job.animationRevision ? {animationRevision: {selectedStates: job.animationRevision.selectedStates, corrections: job.animationRevision.corrections}} : {}), ...(job.animationPrompt ? {animationPrompt: job.animationPrompt} : {}) }), { mode: 0o600 });
      if (revisionAtlas) await writeFile(path.join(directory, "revision-source.webp"), revisionAtlas, {mode: 0o600});
      if (reference) await writeFile(path.join(directory, "reference.png"), reference, {mode: 0o600});
      for (const [name, bytes] of saved) await writeFile(path.join(directory, name + ".png"), bytes, { mode: 0o600 });
    } catch (error) { await rm(directory, { recursive: true, force: true }); throw error; }
    const attempts = new Map<StageName, number>();
    async function command(action: "generate" | "prepare" | "compose", name?: StageName) {
      const started=Date.now();
      const attempt = name ? (attempts.get(name) ?? 0) + 1 : 0;
      if (action === "generate" && name) attempts.set(name, attempt);
      const logHttp = (stderr: unknown) => {
        if (action === "generate" && name && typeof stderr === "string") {
          logSpriteHttpDiagnostic(stderr, {generationId: job.id, stage: name, attempt});
        }
      };
      const readReply = (stdout: string) => {
        try {
          return parseSpritegenReply(stdout);
        } catch (error) {
          if (error instanceof GenerationError && action !== "generate" && error.code === "outcome_unknown") {
            throw new GenerationError("invalid_sprite_extraction", undefined, error.providerFailure, undefined,
              error.diagnostic, error.cliCause, error.details);
          }
          throw error;
        }
      };
      try {
        const args = [script, directory, action, ...(name ? [name] : [])];
        const { stdout, stderr } = await execute(python, args, { env, timeout: 230_000, maxBuffer: 256 * 1024 });
        logHttp(stderr);
        return readReply(stdout);
      } catch (error) {
        if (error instanceof GenerationError) throw error;
        if (error && typeof error === "object" && "stderr" in error) logHttp(error.stderr);
        // Only a structured allowlisted error is consumed; private stderr is never logged.
        if (error && typeof error === "object" && "stdout" in error && typeof error.stdout === "string" && error.stdout.trim()) return readReply(error.stdout);
        throw new GenerationError(action === "generate" ? "outcome_unknown" : "invalid_sprite_extraction",undefined,undefined,undefined,processFailureDiagnostic(error,Date.now()-started));
      }
    }
    return {
      async prepare() { await command("prepare"); },
      async generate(name) {
        if (diagnosticOnly) throw new GenerationError("invalid_stage");
        if (job.continuation && (name === "base" || !job.continuation.generationStages.includes(name))) throw new GenerationError("invalid_stage");
        const result = await command("generate", name);
        let bytes:Buffer;
        try{bytes=await readFile(path.join(directory, name + ".png"));}
        catch(error){throw new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"artifact",reason:error&&typeof error==='object'&&'code'in error&&error.code==='ENOENT'?"missing_file":"io_error"});}
        if (!bytes.length || bytes.length > 8 * 1024 * 1024 || result.generationMs === undefined) throw new GenerationError("outcome_unknown",undefined,undefined,undefined,{boundary:"artifact",reason:result.generationMs===undefined?"missing_duration":"invalid_size",bytes:Math.min(bytes.length,1_073_741_824),usageAvailable:!!result.usage});
        return { bytes, usage: result.usage ?? undefined, generationMs: result.generationMs };
      },
      async compose() {
        await command("compose");
        return readFile(path.join(directory, "run/sprite-sheet-alpha.png"));
      },
      async cleanup() { await rm(directory, { recursive: true, force: true }); },
    };
  },
};
