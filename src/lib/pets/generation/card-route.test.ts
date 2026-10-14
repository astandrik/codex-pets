import {afterEach,beforeEach,describe,expect,it,vi} from "vitest";
import {GenerationError} from "./model";
const edit=vi.hoisted(()=>vi.fn());vi.mock("@/lib/pets/generation/service",()=>({petGeneration:{editMetadata:edit}}));
const id="a".repeat(64),body={revision:0,description:"Blue bus.",tags:["vehicle"]};
beforeEach(()=>{vi.stubEnv("NEXT_PUBLIC_APP_URL","https://pets.example");edit.mockReset();edit.mockResolvedValue({...body,revision:1,editable:true});});afterEach(()=>vi.unstubAllEnvs());
async function invoke(text=JSON.stringify(body),headers:Record<string,string>={}){const{PUT}=await import("@/app/api/pet-generations/[id]/metadata/route");return PUT(new Request(`https://pets.example/api/pet-generations/${id}/metadata`,{method:"PUT",body:text,headers:{origin:"https://pets.example","content-type":"application/json",...headers}}),{params:Promise.resolve({id})});}
describe("private metadata edit route",()=>{
 it("returns saved fields with private headers and calls only editing",async()=>{const r=await invoke();expect(r.status).toBe(200);expect(r.headers.get("cache-control")).toContain("no-store");expect(r.headers.get("referrer-policy")).toBe("no-referrer");expect(edit).toHaveBeenCalledWith(id,body);});
 it("rejects missing or foreign Origin and cross-site requests before the service",async()=>{for(const h of [{origin:""},{origin:"https://evil.example"},{"sec-fetch-site":"cross-site"}] as Record<string,string>[])expect((await invoke(undefined,h)).status).toBe(403);expect(edit).not.toHaveBeenCalled();});
 it("bounds the JSON body by bytes and rejects malformed or non-JSON inputs",async()=>{expect((await invoke("x".repeat(4097))).status).toBe(413);expect((await invoke("{" )).status).toBe(400);expect((await invoke(undefined,{"content-type":"text/plain"})).status).toBe(400);expect(edit).not.toHaveBeenCalled();});
 it("reports conflicts, sealed results and expiry without private errors",async()=>{for(const[code,status]of[["metadata_conflict",409],["metadata_locked",409],["generation_expired",410]]as const){edit.mockRejectedValueOnce(new GenerationError(code));expect((await invoke()).status).toBe(status);}edit.mockRejectedValueOnce(Error("private row and key"));expect(await(await invoke()).text()).not.toContain("private row");});
});
