import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {GET,POST} from "@/app/api/pet-generations/[id]/continuations/route";
import {petGeneration} from "./service";
import {continuationFixture} from "./continuation-fixture.test-utils";
const origin="https://pets.example",context=(id:string)=>({params:Promise.resolve({id})});
beforeEach(()=>{vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");vi.stubEnv("NEXT_PUBLIC_APP_URL",origin);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
const request=(body:unknown,headers:Record<string,string>={})=>new Request(origin+"/api/pet-generations/id/continuations",{method:"POST",headers:{origin,"content-type":"application/json","x-pets-client-ip":"203.0.113.1",...headers},body:JSON.stringify(body)});
async function setup(){const f=await continuationFixture();vi.spyOn(petGeneration,"getContinuationOptions").mockImplementation(f.service.getContinuationOptions);vi.spyOn(petGeneration,"continueGeneration").mockImplementation(f.service.continueGeneration);vi.spyOn(petGeneration,"findContinuation").mockImplementation(f.service.findContinuation);return f;}
it("wires options, accepted POST and UUID recovery to private responses",async()=>{
 const f=await setup(),body=await f.input("rebuild");
 const options=await GET(new Request(origin+"/continuations"),context(f.job.id));expect(options.status).toBe(200);expect(options.headers.get("cache-control")).toContain("no-store");
 const accepted=await POST(request(body),context(f.job.id));expect(accepted.status).toBe(202);const result=await accepted.json();
 const recovered=await GET(new Request(origin+"/continuations?requestId="+body.requestId),context(f.job.id));expect(await recovered.json()).toEqual(result);
 expect(JSON.stringify(result)).not.toMatch(/sha256|reference.png|textInputTokens/);
});
it("rejects cross-origin, unexpected fields and oversized actual bodies before admission",async()=>{
 const f=await setup(),body=await f.input("rebuild");
 expect((await POST(request(body,{origin:"https://foreign.invalid"}),context(f.job.id))).status).toBe(403);
 expect((await POST(request({...body,prompt:"change appearance"}),context(f.job.id))).status).toBe(400);
 expect((await POST(request({...body,states:["base"]}),context(f.job.id))).status).toBe(400);
 expect((await POST(request({...body,padding:"x".repeat(17000)},{"content-length":"1"}),context(f.job.id))).status).toBe(413);
 expect(f.store.ledger.size).toBe(0);
});
