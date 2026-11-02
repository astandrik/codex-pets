import {register} from "node:module";
import {fileURLToPath, pathToFileURL} from "node:url";
import path from "node:path";

const args = process.argv.slice(2);
const value = name => args.find(a => a.startsWith(name + "="))?.slice(name.length + 1);
const action = value("--action"), revision = value("--revision"), limit = value("--active-limit"), providerLimit = value("--provider-limit");
const allowed = /^(--apply|--action=(activate|activate-tasks|downgrade|limit)|--revision=\d+|--active-limit=[12]|--provider-limit=([1-9]|1\d|2[0-2]))$/;
if (args.some(a => !allowed.test(a)) || (action && revision === undefined) || (!action && args.length)) {
  console.error("Usage: generation-scheduler-state.mjs [--action=activate|activate-tasks|downgrade|limit --revision=N [--active-limit=1|2] [--provider-limit=1..22] [--apply]]");
  process.exit(2);
}
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src");
register(new URL("./lib/related-pets-typescript-loader.mjs", import.meta.url), {parentURL: import.meta.url, data: {sourceRootUrl: pathToFileURL(root).href}});
const load = file => import(pathToFileURL(path.join(root, file)).href);
const {generationStore} = await load("lib/pets/generation/store.ts");
const {changeSchedulerState, schedulerSummary} = await load("lib/pets/generation/scheduler-state.ts");
const {scheduler} = await load("lib/pets/generation/scheduler.ts");
const {destroyYdbDriver} = await load("lib/ydb/client.ts");
try {
  const state = action ? await changeSchedulerState(generationStore, {action, expectedRevision: Number(revision), activeLimit: limit ? Number(limit) : undefined, providerLimit: providerLimit ? Number(providerLimit) : undefined, now: Date.now(), apply: args.includes("--apply")})
    : await generationStore.transaction(tx => scheduler(tx, Date.now()));
  console.log(JSON.stringify({applied: args.includes("--apply"), ...schedulerSummary(state)}));
} catch (error) {
  const safe = error instanceof Error && /^scheduler_[a-z_]+$/.test(error.message) ? error.message : "scheduler_operation_failed";
  console.error(JSON.stringify({error: safe})); process.exitCode = 1;
} finally { await destroyYdbDriver(); }
