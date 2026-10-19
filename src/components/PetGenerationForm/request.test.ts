import { webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { prepareGenerationRequest } from "./request";
afterEach(() => vi.unstubAllGlobals());
function storage() { const rows=new Map<string,string>(); return { rows, getItem:(key:string)=>rows.get(key)??null, setItem:(key:string,value:string)=>{rows.set(key,value);} }; }
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

it("separates identical refinements of different saved bases without storing their IDs or edit text", async () => {
  vi.stubGlobal("crypto", webcrypto); const store = storage();
  const first = await prepareGenerationRequest(store, {prompt: "Private scarf change", sourceBaseId: "a".repeat(64)});
  expect((await prepareGenerationRequest(store, {prompt: "Private scarf change", sourceBaseId: "a".repeat(64)})).requestId).toBe(first.requestId);
  expect((await prepareGenerationRequest(store, {prompt: "Private scarf change", sourceBaseId: "b".repeat(64)})).requestId).not.toBe(first.requestId);
  expect(JSON.stringify([...store.rows])).not.toContain("Private scarf change");
  expect(JSON.stringify([...store.rows])).not.toContain("a".repeat(64));
  expect(JSON.stringify([...store.rows])).not.toContain("b".repeat(64));
});


it("preserves a pending refinement when another source or the main form is used", async () => {
  vi.stubGlobal("crypto", webcrypto); const store = storage();
  const brief = {prompt: "Private scarf change", sourceBaseId: "a".repeat(64)};
  const first = await prepareGenerationRequest(store, brief);
  await prepareGenerationRequest(store, {...brief, sourceBaseId: "b".repeat(64)});
  await prepareGenerationRequest(store, {prompt: "A new character"});
  const {startNewGeneration} = await import("./request");
  startNewGeneration({removeItem: key => store.setItem(key, "")});
  expect((await prepareGenerationRequest(store, brief)).requestId).toBe(first.requestId);
});


it("only replays matching pending metadata and clears only the selected source", async () => {
  vi.stubGlobal("crypto", webcrypto); const store = storage();
  const {clearRefinementRequest, hasPendingRefinement} = await import("./request");
  const sourceBaseId = "a".repeat(64), other = "b".repeat(64);
  const brief = {sourceBaseId, prompt: "Private edit"};
  const first = await prepareGenerationRequest(store, brief, 100);
  const second = await prepareGenerationRequest(store, {...brief, sourceBaseId: other}, 100);
  const before = [...store.rows];
  await expect(prepareGenerationRequest(store, {...brief, prompt: "Wrong text", replayOnly: true}, 101)).rejects.toThrow("refinement_replay_mismatch");
  expect([...store.rows]).toEqual(before);
  expect(await prepareGenerationRequest(store, {...brief, replayOnly: true}, 101)).toEqual(first);
  expect([...store.rows]).toEqual(before);
  await expect(prepareGenerationRequest(store, {...brief, replayOnly: true}, 172800101)).rejects.toThrow("refinement_replay_mismatch");
  await clearRefinementRequest({removeItem: key => store.rows.delete(key)}, sourceBaseId);
  expect(await hasPendingRefinement(store, sourceBaseId, 101)).toBe(false);
  await expect(prepareGenerationRequest(store, {...brief, replayOnly: true}, 101)).rejects.toThrow("refinement_replay_mismatch");
  expect((await prepareGenerationRequest(store, {...brief, sourceBaseId: other}, 101)).requestId).toBe(second.requestId);
  expect(JSON.stringify([...store.rows])).not.toContain("Private edit");
});


it("does not replace a pending refinement with changed text or extend its recovery deadline", async () => {
  vi.stubGlobal("crypto", webcrypto); const store = storage();
  const brief = {prompt: "Private edit", sourceBaseId: "a".repeat(64)};
  const first = await prepareGenerationRequest(store, brief, 100);
  const saved = [...store.rows];
  await expect(prepareGenerationRequest(store, {...brief, prompt: "Different edit"}, 101)).rejects.toThrow("refinement_replay_mismatch");
  expect([...store.rows]).toEqual(saved);
  expect(await prepareGenerationRequest(store, brief, 102)).toEqual(first);
  expect([...store.rows]).toEqual(saved);
});


it("retains a refinement identity for delayed acceptance without sliding its deadline", async () => {
  vi.stubGlobal("crypto", webcrypto); const store = storage();
  const {hasPendingRefinement} = await import("./request");
  const brief = {prompt: "Private edit", sourceBaseId: "a".repeat(64)};
  const start = 100, day = 86400000;
  const first = await prepareGenerationRequest(store, brief, start);
  const saved = [...store.rows];
  expect(await hasPendingRefinement(store, brief.sourceBaseId, start + day + 3600000)).toBe(true);
  expect(await prepareGenerationRequest(store, brief, start + 47 * 3600000)).toEqual(first);
  expect([...store.rows]).toEqual(saved);
  expect(await hasPendingRefinement(store, brief.sourceBaseId, start + 2 * day - 1)).toBe(true);
  expect(await hasPendingRefinement(store, brief.sourceBaseId, start + 2 * day)).toBe(false);
});
