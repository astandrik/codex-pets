import {afterEach,beforeEach,expect,it,vi} from "vitest";
import {GET,POST} from "@/app/api/pet-generations/[id]/continuations/route";
import {createGenerationService,petGeneration} from "./service";
import {continuationFixture} from "./continuation-fixture.test-utils";
const origin="https://pets.example",context=(id:string)=>({params:Promise.resolve({id})});
beforeEach(()=>{vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","true");vi.stubEnv("NEXT_PUBLIC_APP_URL",origin);});
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
const request=(body:unknown,headers:Record<string,string>={})=>new Request(origin+"/api/pet-generations/id/continuations",{method:"POST",headers:{origin,"content-type":"application/json","x-pets-client-ip":"203.0.113.1",...headers},body:JSON.stringify(body)});
async function setup(automatic=false){
 const f=await continuationFixture(),settings={automatic};
 const service=createGenerationService(f.store,{now:()=>f.config.now,enabled:()=>f.config.enabled,automaticAnimationRepair:()=>settings.automatic,secret:()=>"continuation-test-secret"});
 vi.spyOn(petGeneration,"getContinuationOptions").mockImplementation(service.getContinuationOptions);
 vi.spyOn(petGeneration,"continueGeneration").mockImplementation(service.continueGeneration);
 vi.spyOn(petGeneration,"findContinuation").mockImplementation(service.findContinuation);
 return {...f,service,settings};
}
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

it.each([true,false])("advertises retry limits through GET only when automatic repair is enabled: %s",async automatic=>{
 const f=await setup(automatic);
 const response=await GET(new Request(origin+"/continuations"),context(f.job.id));
 expect(response.status).toBe(200);
 const {options}=await response.json();
 if(automatic)expect(options.regenerationRetries).toEqual({min:0,default:5,max:50});
 else expect(options).not.toHaveProperty("regenerationRetries");
 expect(f.store.jobs.size).toBe(1);expect(f.store.ledger.size).toBe(0);
});

it.each([{retries:0,attempts:1},{retries:1,attempts:2},{retries:5,attempts:6},{retries:50,attempts:51}])(
 "persists $retries retries as $attempts attempts through POST and recovers the same operation",async({retries,attempts})=>{
 const f=await setup(true),body={...await f.input("regenerate",["waving"]),maxRetries:retries};
 const source=structuredClone(await f.store.readJob(f.job.id));
 const accepted=await POST(request(body),context(f.job.id));expect(accepted.status).toBe(202);
 const result=await accepted.json(),job=await f.store.readJob(result.generation.generationId);
 expect(job!.animationRepair).toMatchObject({policy:2,maxAttempts:attempts});
 const ledger=structuredClone(f.store.ledger);
 const recovered=await GET(new Request(origin+"/continuations?requestId="+body.requestId),context(f.job.id));
 expect(recovered.status).toBe(200);expect(await recovered.json()).toEqual(result);
 const replay=await POST(request(body),context(f.job.id));
 expect(replay.status).toBe(202);expect(await replay.json()).toEqual(result);
 expect(f.store.jobs.size).toBe(2);expect(f.store.ledger).toEqual(ledger);
 expect(await f.store.readJob(f.job.id)).toEqual(source);
});

it.each([-1,1.5,51,"5","not-a-number",null])("rejects invalid retry count %s through POST before admission",async maxRetries=>{
 const f=await setup(true),body={...await f.input("regenerate",["waving"]),maxRetries};
 const response=await POST(request(body),context(f.job.id));
 expect(response.status).toBe(400);expect((await response.json()).code).toBe("invalid_argument");
 expect(f.store.jobs.size).toBe(1);expect(f.store.ledger.size).toBe(0);
});

it("rejects retry counts on rebuild through POST before admission",async()=>{
 const f=await setup(true),body={...await f.input("rebuild"),maxRetries:0};
 const response=await POST(request(body),context(f.job.id));
 expect(response.status).toBe(400);expect((await response.json()).code).toBe("invalid_argument");
 expect(f.store.jobs.size).toBe(1);expect(f.store.ledger.size).toBe(0);
});

it("rejects a new explicit retry count when automatic repair is disabled",async()=>{
 const f=await setup(),body={...await f.input("regenerate",["waving"]),maxRetries:5};
 const response=await POST(request(body),context(f.job.id));
 expect(response.status).toBe(503);expect((await response.json()).code).toBe("generation_disabled");
 expect(f.store.jobs.size).toBe(1);expect(f.store.ledger.size).toBe(0);
});

it("recovers and replays the accepted UUID after admission flags are disabled",async()=>{
 const f=await setup(true),body={...await f.input("regenerate",["waving"]),maxRetries:5};
 const accepted=await POST(request(body),context(f.job.id));expect(accepted.status).toBe(202);
 const result=await accepted.json(),ledger=structuredClone(f.store.ledger);
 f.settings.automatic=false;vi.stubEnv("PET_GENERATION_CONTINUATION_ENABLED","false");
 const recovered=await GET(new Request(origin+"/continuations?requestId="+body.requestId),context(f.job.id));
 expect(recovered.status).toBe(200);expect(await recovered.json()).toEqual(result);
 const replay=await POST(request(body),context(f.job.id));
 expect(replay.status).toBe(202);expect(await replay.json()).toEqual(result);
 expect(f.store.jobs.size).toBe(2);expect(f.store.ledger).toEqual(ledger);
 expect((await f.store.readJob(result.generation.generationId))!.animationRepair).toMatchObject({policy:2,maxAttempts:6});
});

it("rejects a changed retry count for the same UUID without changing the accepted operation",async()=>{
 const f=await setup(true),body={...await f.input("regenerate",["waving"]),maxRetries:5};
 const accepted=await POST(request(body),context(f.job.id));expect(accepted.status).toBe(202);
 const result=await accepted.json(),jobs=structuredClone(f.store.jobs),ledger=structuredClone(f.store.ledger);
 const conflict=await POST(request({...body,maxRetries:6}),context(f.job.id));
 expect(conflict.status).toBe(409);expect((await conflict.json()).code).toBe("request_id_conflict");
 const recovered=await GET(new Request(origin+"/continuations?requestId="+body.requestId),context(f.job.id));
 expect(await recovered.json()).toEqual(result);
 const replay=await POST(request(body),context(f.job.id));
 expect(replay.status).toBe(202);expect(await replay.json()).toEqual(result);
 expect(f.store.jobs).toEqual(jobs);expect(f.store.ledger).toEqual(ledger);
});

it.each([true,false])("preserves omitted retry counts and the old UUID payload with automatic repair: %s",async automatic=>{
 const f=await setup(automatic),body=await f.input("regenerate",["waving"]);
 const accepted=await POST(request(body),context(f.job.id));expect(accepted.status).toBe(202);
 const result=await accepted.json(),job=await f.store.readJob(result.generation.generationId);
 if(automatic)expect(job!.animationRepair).toMatchObject({policy:1,maxAttempts:4});
 else expect(job!.animationRepair).toBeUndefined();
 const ledger=structuredClone(f.store.ledger);
 const recovered=await GET(new Request(origin+"/continuations?requestId="+body.requestId),context(f.job.id));
 expect(await recovered.json()).toEqual(result);
 const replay=await POST(request(body),context(f.job.id));
 expect(replay.status).toBe(202);expect(await replay.json()).toEqual(result);
 const changed=await POST(request({...body,maxRetries:5}),context(f.job.id));
 expect(changed.status).toBe(409);expect((await changed.json()).code).toBe("request_id_conflict");
 expect(f.store.jobs.size).toBe(2);expect(f.store.ledger).toEqual(ledger);
});
