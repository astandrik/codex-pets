import { mkdtemp, mkdir, writeFile, access, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, it } from "vitest";
import { cleanupSpriteWorkspaces } from "./workspace";

it("cleans expired files and dead-process leftovers while retaining live work and unrelated files",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"sprite-cleanup-test-"));
  try {
    for(const [name,expiresAt,pid] of [["pets-row-worker-expired",10,1],["pets-row-worker-orphan",1000,2],["pets-row-worker-live",1000,1],["unrelated",10,2]] as const) {
      const folder=path.join(root,name);await mkdir(folder);await writeFile(path.join(folder,"workspace.json"),JSON.stringify({expiresAt,pid}));await writeFile(path.join(folder,"prompt.txt"),"synthetic private prompt");
    }
    await cleanupSpriteWorkspaces(root,100,pid=>pid===1);
    await expect(access(path.join(root,"pets-row-worker-expired"))).rejects.toThrow();
    await expect(access(path.join(root,"pets-row-worker-orphan"))).rejects.toThrow();
    await expect(access(path.join(root,"pets-row-worker-live"))).resolves.toBeUndefined();
    await expect(access(path.join(root,"unrelated"))).resolves.toBeUndefined();
  }finally{await rm(root,{recursive:true,force:true});}
});

it("does not delete another active renderer after job expiry or during initial metadata write", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "sprite-active-test-"));
  try {
    const working = path.join(root, "pets-row-worker-active");
    const opening = path.join(root, "pets-row-worker-12345-opening");
    await mkdir(working); await mkdir(opening);
    await writeFile(path.join(working, "workspace.json"), JSON.stringify({expiresAt: 10, pid: 12345, active: true}));
    await cleanupSpriteWorkspaces(root, 100, pid => pid === 12345);
    await expect(access(working)).resolves.toBeUndefined();
    await expect(access(opening)).resolves.toBeUndefined();
  } finally { await rm(root, {recursive: true, force: true}); }
});
