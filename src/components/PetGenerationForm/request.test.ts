import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareGenerationRequest } from "./request";
afterEach(() => vi.unstubAllGlobals());
function storage() { const rows=new Map<string,string>(); return { getItem:(key:string)=>rows.get(key)??null, setItem:(key:string,value:string)=>{rows.set(key,value);} }; }
describe("browser generation idempotency", () => {
  it("keeps the same request id across lost responses and form remounts without storing the prompt", async () => {
    vi.stubGlobal("crypto",webcrypto); const store=storage();
    const first=await prepareGenerationRequest(store,{prompt:"  A private fox  ",displayName:" Fox "},100);
    const second=await prepareGenerationRequest(store,{prompt:"A private fox",displayName:"Fox"},101);
    expect(second).toEqual(first); expect(JSON.stringify(store.getItem("pets-generation-request"))).not.toContain("private fox");
    expect((await prepareGenerationRequest(store,{prompt:"A new robot"},102)).requestId).not.toBe(first.requestId);
  });
  it("replaces invalid or expired stored metadata", async () => {
    vi.stubGlobal("crypto",webcrypto); const store=storage(); store.setItem("pets-generation-request","malformed");
    const first=await prepareGenerationRequest(store,{prompt:"fox"},0);
    const second=await prepareGenerationRequest(store,{prompt:"fox"},86400001);
    expect(first.requestId).not.toBe(second.requestId);
  });
  it("does not send a task when stable idempotency metadata cannot be saved", async () => {
    vi.stubGlobal("crypto",webcrypto);
    await expect(prepareGenerationRequest({getItem:()=>null,setItem:()=>{throw new Error("blocked storage");}},{prompt:"fox"},0)).rejects.toThrow("blocked storage");
  });
});

it("includes image bytes in identity and treats an explicit new attempt differently from retry", async () => {
  vi.stubGlobal("crypto", webcrypto); const store = storage();
  const referenceImage = new Blob(["synthetic-image"]);
  const first = await prepareGenerationRequest(store, {prompt: "", referenceImage});
  expect((await prepareGenerationRequest(store, {prompt: "", referenceImage: new Blob(["synthetic-image"])})).requestId).toBe(first.requestId);
  expect((await prepareGenerationRequest(store, {prompt: "", referenceImage: new Blob(["different-image"])})).requestId).not.toBe(first.requestId);
  expect(JSON.stringify(store.getItem("pets-generation-request"))).not.toContain("synthetic-image");
  const {startNewGeneration} = await import("./request");
  startNewGeneration({removeItem: key => store.setItem(key, "")});
  expect((await prepareGenerationRequest(store, {prompt: "", referenceImage})).requestId).not.toBe(first.requestId);
});
