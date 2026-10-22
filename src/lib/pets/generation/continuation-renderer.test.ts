import {readFile} from "node:fs/promises";
import path from "node:path";
import {afterEach,expect,it,vi} from "vitest";
import {continuationFixture} from "./continuation-fixture.test-utils";
const execute=vi.hoisted(()=>vi.fn(async()=>({stdout:'{"ok":true}',stderr:''})));
vi.mock("node:child_process",()=>({execFile:Object.assign(vi.fn(),{[Symbol.for("nodejs.util.promisify.custom")]:execute})}));
import {spriteRenderer} from "./sprite-renderer";
afterEach(()=>{vi.unstubAllEnvs();execute.mockClear();});
it("rebuild renderer works without image credentials and rejects every image call",async()=>{
  vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");vi.stubEnv("PET_GENERATION_OPENAI_KEY_FILE","/missing-private-key");vi.stubEnv("PET_GENERATION_PROXY_URL","");
  const f=await continuationFixture();await f.service.continueGeneration(f.job.id,await f.input("rebuild"),null);
  const session=await spriteRenderer.open(f.store.jobs.get(f.job.id)!,new Map([["base",f.image]]));
  try {
    await expect(session.generate("base")).rejects.toMatchObject({code:"invalid_stage"});
    await expect(session.generate("idle")).rejects.toMatchObject({code:"invalid_stage"});
    expect(execute).not.toHaveBeenCalled();await session.prepare();
    const [,args,options]=execute.mock.calls[0] as unknown as [string,string[],{env:Record<string,string>}];
    expect(options.env).not.toHaveProperty("OPENAI_API_KEY");expect(options.env).not.toHaveProperty("HTTPS_PROXY");
    const payload=JSON.parse(await readFile(path.join(args[1],"job.json"),"utf8"));
    expect(payload.rows.filter((r:{name:string})=>r.name.startsWith("look-")).map((r:{row:number})=>r.row)).toEqual([9,10]);
  } finally {await session.cleanup();}
});
