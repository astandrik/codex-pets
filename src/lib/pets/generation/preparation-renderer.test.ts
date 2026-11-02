import {mkdtemp,writeFile,readFile,rm} from "node:fs/promises";
import {tmpdir} from "node:os";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {spriteRenderer} from "./sprite-renderer";
import {taskFixture} from "./task-pool.test-utils";
afterEach(()=>vi.unstubAllEnvs());
it("reuses preparation after the first workspace is removed and invalidates changed input",async()=>{
  const root=await mkdtemp(path.join(tmpdir(),"pets-preparation-test-"));
  const executable=path.join(root,"python.mjs");
  await writeFile(executable,`#!${process.execPath}\nimport fs from 'node:fs/promises';import path from 'node:path';import {fileURLToPath} from 'node:url';\nconst [script,dir,action]=process.argv.slice(2);if(action!=='prepare')throw Error('unexpected action');\nawait fs.appendFile(path.join(path.dirname(fileURLToPath(import.meta.url)),'calls'),'prepare\\n');\nawait fs.mkdir(path.join(dir,'run'),{recursive:true});await fs.writeFile(path.join(dir,'run','guide'),'synthetic guide');console.log('{"ok":true}');\n`,{mode:0o700});
  vi.stubEnv("PET_GENERATION_PYTHON",executable);
  const f=await taskFixture();const job={...f.jobs[0],expiresAt:Date.now()+60000,workerTask:{key:"test",kind:"image" as const,stage:"idle" as const}};
  const saved=new Map([["base" as const,Buffer.from("base")]]);
  let guards=0;
  try{
    for(const current of [job,job,{...job,prompt:"Changed character input"}]){
      const session=await spriteRenderer.open(current,saved,undefined,undefined,{diagnosticOnly:true});
      try{await session.prepare(async operation=>{guards++;return operation();});}finally{await session.cleanup();}
    }
    expect(guards).toBe(2);
    expect((await readFile(path.join(root,"calls"),"utf8")).trim().split("\n")).toEqual(["prepare","prepare"]);
  }finally{await rm(root,{recursive:true,force:true});}
});
