import {mkdtemp, writeFile, readFile, rm} from "node:fs/promises";
import path from "node:path";
import {tmpdir} from "node:os";
import sharp from "sharp";
import JSZip from "jszip";
import {afterEach, expect, it, vi} from "vitest";
import {PET_STATES} from "@/lib/pets/types";
import {validateUploadedPackage} from "@/lib/pets/package";
import {revisionFixture} from "./animation-revision-fixture.test-utils";
import {createSpriteGenerationWorker} from "./sprite-worker";
import {spriteRenderer} from "./sprite-renderer";
import {PET_SHEETS} from "@/lib/pets/types";

vi.mock("node:fs/promises", async importOriginal => {
  const actual = await importOriginal<typeof import("node:fs/promises")>();
  return {...actual, mkdtemp: vi.fn(actual.mkdtemp)};
});
afterEach(()=>{vi.unstubAllEnvs();vi.clearAllMocks();});

it("transports revision snapshots and instructions through the real bridge without any provider call",async()=>{
  vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED","true");
  const f=await revisionFixture();const child=await f.service.reviseAnimations(f.source.id,f.input(),"203.0.113.9");
  const keyDirectory=await mkdtemp(path.join(tmpdir(),"revision-synthetic-key-"));
  await writeFile(path.join(keyDirectory,"key"),"synthetic-provider-key",{mode:0o600});
  vi.stubEnv("PET_GENERATION_OPENAI_KEY_FILE",path.join(keyDirectory,"key"));vi.stubEnv("PET_GENERATION_PROXY_URL","http://172.17.0.1:18090");
  const job=(await f.store.readJob(child.generationId))!;
  const session=await spriteRenderer.open(job,new Map([["base",f.base]]),undefined,f.files["spritesheet.webp"]);
  try {
    const workspace=await vi.mocked(mkdtemp).mock.results.at(-1)!.value;
    const payload=JSON.parse(await readFile(path.join(workspace,"job.json"),"utf8"));
    expect(payload.animationAnatomyPolicy).toBe(1);expect(payload.animationRevision.selectedStates).toEqual(["idle","waving"]);
    expect(payload.animationRevision.corrections).toEqual({idle:["Tilt without adding arms"],waving:["Tilt without adding arms"]});
    expect(payload.rows.filter((row:{name:string})=>["running-left","running-right","waving"].includes(row.name))).toEqual([
      expect.objectContaining({name:"running-right",row:1,frames:8}),expect.objectContaining({name:"running-left",row:2,frames:8}),expect.objectContaining({name:"waving",row:3,frames:4}),
    ]);
    expect(await readFile(path.join(workspace,"revision-source.webp"))).toEqual(f.files["spritesheet.webp"]);
    expect(await readFile(path.join(workspace,"base.png"))).toEqual(f.base);
  }finally{await session.cleanup();await rm(keyDirectory,{recursive:true});}
});

it("creates and accepts a valid selective package, preserving base and all other canonical RGBA rows",async()=>{
  vi.stubEnv("PET_GENERATION_ANIMATION_REVISIONS_ENABLED","true");
  const f=await revisionFixture();const child=await f.service.reviseAnimations(f.source.id,f.input(),"203.0.113.9");
  const calls:string[]=[];
  const run=createSpriteGenerationWorker({service:f.service,store:f.store,now:()=>f.config.now,renderer:{open:async(job,saved,_reference,source)=>{
    expect(saved.get("base")).toEqual(f.base);
    const decoded=await sharp(source!).ensureAlpha().raw().toBuffer();
    return {prepare:async()=>undefined,generate:async name=>{calls.push(name);return {bytes:f.base,generationMs:1,usage:{textInputTokens:1,imageInputTokens:1,outputTokens:1,costUsd:.01}};},compose:async()=>{
      for(const state of PET_STATES.filter(state=>job.animationRevision!.selectedStates.includes(state.key))){
        for(let y=state.row*208;y<(state.row+1)*208;y++)for(let x=0;x<1536;x++){
          const offset=(y*1536+x)*4;if(decoded[offset+3])decoded[offset]=250;
        }
      }
      return sharp(decoded,{raw:{width:1536,height:2288,channels:4}}).png().toBuffer();
    },cleanup:async()=>undefined};
  }}});
  expect(await run("synthetic")).toBe("completed");expect(calls).toEqual(["idle","waving"]);
  const after=f.store.artifacts.get(child.generationId+":spritesheet.webp")!.bytes;
  const beforePixels=await sharp(f.files["spritesheet.webp"]).ensureAlpha().raw().toBuffer();
  const afterPixels=await sharp(after).ensureAlpha().raw().toBuffer();
  for(const bytes of [beforePixels,afterPixels])for(let i=0;i<bytes.length;i+=4)if(bytes[i+3]===0)bytes.fill(0,i,i+3);
  for(let row=0;row<PET_SHEETS[2].rows;row++){
    const before=beforePixels.subarray(row*208*1536*4,(row+1)*208*1536*4),after=afterPixels.subarray(row*208*1536*4,(row+1)*208*1536*4);
    if([0,3].includes(row))expect(after.equals(before)).toBe(false);else expect(after.equals(before)).toBe(true);
  }
  const zipBuffer=f.store.artifacts.get(child.generationId+":pet.zip")!.bytes;
  const petJsonBuffer=f.store.artifacts.get(child.generationId+":pet.json")!.bytes;
  const archive=await JSZip.loadAsync(zipBuffer);
  expect(Object.keys(archive.files).sort()).toEqual(["pet.json","spritesheet.webp"]);
  expect(petJsonBuffer.toString()).not.toMatch(/Tilt|sourceGeneration|Move gently/);
  expect((await validateUploadedPackage({petJsonBuffer,spritesheetBuffer:after,zipBuffer,spritesheetExt:"webp"})).ok).toBe(true);
  const accepted=await f.service.acceptAnimationRevision(child.generationId);
  expect(accepted.pet?.zipUrl).toBeDefined();expect(await f.service.getBase(child.generationId)).toEqual(f.base);
  expect(f.store.jobs.get(f.source.id)).toEqual(f.source);
});
