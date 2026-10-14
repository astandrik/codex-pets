import { readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";

function processAlive(pid: number) {
  try { process.kill(pid,0); return true; }
  catch(error) { return Boolean(error && typeof error === "object" && "code" in error && error.code === "EPERM"); }
}
export async function cleanupSpriteWorkspaces(root: string, now: number, alive = processAlive) {
  for (const entry of await readdir(root,{withFileTypes:true})) {
    if (!entry.isDirectory() || !entry.name.startsWith("pets-row-worker-")) continue;
    const folder=path.join(root,entry.name);
    let keep=false;
    try {
      const metadata: unknown=JSON.parse(await readFile(path.join(folder,"workspace.json"),"utf8"));
      if (metadata && typeof metadata==="object" && "expiresAt" in metadata && typeof metadata.expiresAt==="number" && metadata.expiresAt>now && "pid" in metadata && typeof metadata.pid==="number" && Number.isSafeInteger(metadata.pid) && metadata.pid>0) keep=alive(metadata.pid);
    } catch { /* Incomplete workspace metadata precedes any private file write. */ }
    if (!keep) await rm(folder,{recursive:true,force:true});
  }
}
