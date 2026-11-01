import {afterEach,expect,it,vi} from "vitest";
import {GET,POST} from "@/app/api/pet-generations/[id]/base-retries/route";
import {GET as referenceGET} from "@/app/api/pet-generations/[id]/base-retries/reference/route";
import {petGeneration} from "./service";
import {baseRetryFixture} from "./base-retry-fixture.test-utils";
import {randomUUID} from "node:crypto";
import {WAIT_MS} from "./model";
afterEach(()=>{vi.restoreAllMocks();vi.unstubAllEnvs();});
const context=(id:string)=>({params:Promise.resolve({id})});
const request=(body:unknown,extra:Record<string,string>={})=>new Request("https://pets.example/api",{method:"POST",headers:{origin:"https://pets.example","content-type":"application/json","x-pets-client-ip":"203.0.113.8",...extra},body:JSON.stringify(body)});
async function setup(){
 vi.stubEnv("NEXT_PUBLIC_APP_URL","https://pets.example");
 const f=await baseRetryFixture();
 vi.spyOn(petGeneration,"getBaseRetryOptions").mockImplementation(f.service.getBaseRetryOptions);
 vi.spyOn(petGeneration,"getBaseRetryReference").mockImplementation(f.service.getBaseRetryReference);
 vi.spyOn(petGeneration,"findBaseRetry").mockImplementation(f.service.findBaseRetry);
 vi.spyOn(petGeneration,"retryBaseGeneration").mockImplementation(f.service.retryBaseGeneration);
 return f;
}
it("serves options/reference and lookup without creating work",async()=>{
 const f=await setup(),before=structuredClone([...f.store.ledger]);
 const r=await GET(new Request("https://pets.example/api"),context(f.id));expect(r.status).toBe(200);
 const image=await referenceGET(new Request("https://pets.example/api?v="+f.reference!.metadata.sha256),context(f.id));
 expect(image.headers.get("content-type")).toBe("image/png");expect(Buffer.from(await image.arrayBuffer())).toEqual(f.reference!.bytes);
 expect([...f.store.ledger]).toEqual(before);
 for(const response of [r,image]){expect(response.headers.get("cache-control")).toBe("private, no-store");expect(response.headers.get("referrer-policy")).toBe("no-referrer");}
 const input=await f.input(),created=await POST(request(input),context(f.id));expect(created.status).toBe(202);
 const check=await GET(new Request("https://pets.example/api?requestId="+input.requestId),context(f.id));expect(await check.json()).toEqual({...await created.json(),reused:true});
});
it("rejects foreign origin, forged IP fallback, unknown fields and oversized JSON",async()=>{
 const f=await setup(),input=await f.input();
 expect((await POST(request(input,{origin:"https://evil.invalid"}),context(f.id))).status).toBe(403);
 expect((await POST(request({...input,url:"https://evil.invalid"}),context(f.id))).status).toBe(400);
 expect((await POST(request({...input,padding:"x".repeat(17000)}),context(f.id))).status).toBe(413);
 const fakeIp=request(input);fakeIp.headers.delete("x-pets-client-ip");fakeIp.headers.set("x-forwarded-for","203.0.113.8");
 expect((await POST(fakeIp,context(f.id))).status).toBe(503);expect(f.store.jobs.size).toBe(1);
});
it("keeps private headers and distinct errors on invalid/expired/versioned reads",async()=>{
 const f=await setup();
 const wrong=await referenceGET(new Request("https://pets.example/api?v="+"a".repeat(64)),context(f.id));expect(wrong.status).toBe(409);
 f.config.now=f.store.jobs.get(f.id)!.expiresAt;
 const expired=await GET(new Request("https://pets.example/api"),context(f.id));expect(expired.status).toBe(410);expect(expired.headers.get("cache-control")).toContain("no-store");
});

it("offers an unpersisted timeout through GET and admits it once through POST", async () => {
 const f = await setup();
 const queued = await f.service.generate({requestId: randomUUID(), prompt: "Queued pet"}, "203.0.113.8", {reviewBase: true, reference: f.reference});
 f.config.now += WAIT_MS + 1;
 const before = structuredClone([...f.store.ledger]);
 const optionsResponse = await GET(new Request("https://pets.example/api"), context(queued.generationId));
 expect(optionsResponse.status).toBe(200);
 const {options} = await optionsResponse.json();
 expect(options.inputState).toBe("saved");
 expect([...f.store.ledger]).toEqual(before);
 expect(f.store.jobs.get(queued.generationId)?.status).toBe("queued");
 const input = {requestId: randomUUID(), mode: "saved", sourceRevision: options.sourceRevision};
 const first = await POST(request(input), context(queued.generationId));
 const second = await POST(request(input), context(queued.generationId));
 expect(first.status).toBe(202);
 expect(second.status).toBe(202);
 const accepted = await first.json(), replay = await second.json();
 expect(replay.generation.generationId).toBe(accepted.generation.generationId);
 expect(replay.reused).toBe(true);
 expect(f.store.jobs.size).toBe(3);
});
