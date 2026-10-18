// @vitest-environment jsdom
import {afterEach,beforeEach, describe, expect, it, vi} from "vitest";
import {HISTORY_PREFIX, readGenerationHistory, pruneGenerationHistory, rememberGeneration, notifyGenerationHistory, parseHistoryGeneration} from "./history";
const now=Date.parse("2026-10-12T12:00:00Z"), id="a".repeat(64), expires=new Date(now+86400000).toISOString();
beforeEach(()=>localStorage.clear());
afterEach(()=>vi.restoreAllMocks());
describe("private browser generation history",()=>{
 it("persists only private ID and timestamps, deduplicates and survives a new read",()=>{
  expect(rememberGeneration(id,expires,now)).toBe(true);
  expect(rememberGeneration(id,expires,now+1000)).toBe(true);
  expect(readGenerationHistory(now+2000)).toEqual({available:true,entries:[{generationId:id,savedAt:now,expiresAt:Date.parse(expires)}]});
  expect(Object.keys(JSON.parse(localStorage.getItem(HISTORY_PREFIX+id)!)).sort()).toEqual(["expiresAt","generationId","savedAt"]);
 });
 it("keeps independent tab additions instead of overwriting an entire list",()=>{
  rememberGeneration(id,expires,now);rememberGeneration("b".repeat(64),expires,now+1);
  expect(readGenerationHistory(now+2).entries.map(x=>x.generationId)).toEqual(["b".repeat(64),id]);
  expect(localStorage.length).toBe(2);
 });
 it("rejects paths, foreign URLs, invalid expiry and mismatched or oversized stored data",()=>{
  for(const bad of ["javascript:alert(1)","../other",`https://evil.example/${id}`,"A".repeat(64)])expect(rememberGeneration(bad,expires,now)).toBe(false);
  expect(rememberGeneration(id,"invalid",now)).toBe(false);
  localStorage.setItem(HISTORY_PREFIX+id,JSON.stringify({generationId:"b".repeat(64),savedAt:now,expiresAt:now+1}));
  localStorage.setItem(HISTORY_PREFIX+"c".repeat(64),"x".repeat(2000));
  expect(readGenerationHistory(now).entries).toEqual([]);
 });
 it("retains an expired status for seven days, then hides it without touching unrelated records",()=>{
  rememberGeneration(id,expires,now);localStorage.setItem("unrelated","keep");
  expect(readGenerationHistory(now+2*86400000).entries).toHaveLength(1);
  expect(readGenerationHistory(now+8*86400000).entries).toEqual([]);
  expect(localStorage.getItem("unrelated")).toBe("keep");
 });
 it("bounds history to the fifty most recently saved entries",()=>{
  for(let i=0;i<51;i++)rememberGeneration(i.toString(16).padStart(64,"0"),expires,now+i);
  const entries=readGenerationHistory(now+52).entries;expect(entries).toHaveLength(50);expect(entries[0].savedAt).toBe(now+50);expect(entries.at(-1)?.savedAt).toBe(now+1);
 });
 it("reports blocked browser storage without throwing or starting anything",()=>{
  const storage={get length():number{throw Error("blocked")},key:vi.fn(),getItem:vi.fn(),setItem:vi.fn(()=>{throw Error("full")}),removeItem:vi.fn()};
  expect(readGenerationHistory(now,storage)).toEqual({available:false,entries:[]});expect(rememberGeneration(id,expires,now,storage)).toBe(false);
 });
 it("validates the exact requested capability and ignores server-supplied URLs or private fields",()=>{
  const value={generationId:id,status:"completed",expiresAt:expires,progress:{completedSteps:12,totalSteps:12},pet:{displayName:"Synthetic",zipUrl:"https://evil.example"},prompt:"private"};
  expect(parseHistoryGeneration(value,id)).toEqual({generationId:id,status:"completed",expiresAt:expires,progress:{completedSteps:12,totalSteps:12},pet:{displayName:"Synthetic"}});
  expect(parseHistoryGeneration({...value,generationId:"b".repeat(64)},id)).toBeNull();
  expect(parseHistoryGeneration({...value,progress:{completedSteps:13,totalSteps:12}},id)).toBeNull();
 });
});

function memoryStorage(initial: Record<string, string>) {
  const values = new Map(Object.entries(initial));
  return {
    get length() { return values.size; },
    key: (index: number) => [...values.keys()][index] ?? null,
    getItem: vi.fn((key: string) => values.get(key) ?? null),
    setItem: vi.fn((key: string, value: string) => { values.set(key, value); }),
    removeItem: vi.fn((key: string) => { values.delete(key); }),
  };
}
const staleId = "e".repeat(64);
const staleEntry = JSON.stringify({ generationId: staleId, savedAt: now - 8 * 86400000, expiresAt: now - 7 * 86400000 });
const currentEntry = JSON.stringify({ generationId: id, savedAt: now, expiresAt: Date.parse(expires) });

describe("history read and cleanup separation", () => {
  it("reads and filters a storage interface that has no mutation methods", () => {
    const storage = memoryStorage({ [HISTORY_PREFIX + staleId]: staleEntry, [HISTORY_PREFIX + id]: currentEntry });
    const readOnly = { length: storage.length, key: storage.key, getItem: storage.getItem };
    expect(readGenerationHistory(now, readOnly)).toEqual({ available: true, entries: [JSON.parse(currentEntry)] });
  });

  it("limits a read to fifty entries without pruning until explicitly requested", () => {
    const records = Object.fromEntries(Array.from({ length: 52 }, (_, index) => {
      const generationId = index.toString(16).padStart(64, "0");
      return [HISTORY_PREFIX + generationId, JSON.stringify({ generationId, savedAt: now + index, expiresAt: Date.parse(expires) })];
    }));
    const storage = memoryStorage(records);
    const history = readGenerationHistory(now + 53, storage);
    expect(history.available).toBe(true);
    expect(history.entries).toHaveLength(50);
    expect(history.entries[0].savedAt).toBe(now + 51);
    expect(history.entries.at(-1)?.savedAt).toBe(now + 2);
    expect(storage.length).toBe(52);
    expect(storage.removeItem).not.toHaveBeenCalled();
    expect(storage.setItem).not.toHaveBeenCalled();
    expect(pruneGenerationHistory(now + 53, storage)).toBe(true);
    expect(storage.length).toBe(50);
  });

  it("keeps the exact seven-day boundary and ignores unrelated or malformed records", () => {
    const malformedKey = HISTORY_PREFIX + "f".repeat(64);
    const storage = memoryStorage({ [HISTORY_PREFIX + staleId]: staleEntry, unrelated: "keep", [malformedKey]: "not-json" });
    expect(pruneGenerationHistory(now - 1, storage)).toBe(true);
    expect(storage.getItem(HISTORY_PREFIX + staleId)).toBe(staleEntry);
    expect(pruneGenerationHistory(now, storage)).toBe(true);
    expect(storage.getItem(HISTORY_PREFIX + staleId)).toBeNull();
    expect(storage.getItem("unrelated")).toBe("keep");
    expect(storage.getItem(malformedKey)).toBe("not-json");
  });

  it("keeps readable entries when cleanup is blocked", () => {
    const storage = memoryStorage({ [HISTORY_PREFIX + staleId]: staleEntry, [HISTORY_PREFIX + id]: currentEntry });
    storage.removeItem.mockImplementation(() => { throw new Error("cleanup blocked"); });
    expect(pruneGenerationHistory(now, storage)).toBe(true);
    expect(readGenerationHistory(now, storage).entries).toEqual([JSON.parse(currentEntry)]);
  });

  it("continues cleanup after one key fails", () => {
    const secondId = "d".repeat(64), secondKey = HISTORY_PREFIX + secondId;
    const storage = memoryStorage({ [HISTORY_PREFIX + staleId]: staleEntry, [secondKey]: JSON.stringify({ ...JSON.parse(staleEntry), generationId: secondId }) });
    const remove = storage.removeItem.getMockImplementation()!;
    storage.removeItem.mockImplementation((key) => { if (key === HISTORY_PREFIX + staleId) throw new Error("blocked key"); remove(key); });
    expect(pruneGenerationHistory(now, storage)).toBe(true);
    expect(storage.getItem(HISTORY_PREFIX + staleId)).toBe(staleEntry);
    expect(storage.getItem(secondKey)).toBeNull();
  });

  it("reports a successful save even when only deletion is blocked", () => {
    const storage = memoryStorage({ [HISTORY_PREFIX + staleId]: staleEntry });
    storage.removeItem.mockImplementation(() => { throw new Error("cleanup blocked"); });
    expect(rememberGeneration(id, expires, now, storage)).toBe(true);
    expect(JSON.parse(storage.getItem(HISTORY_PREFIX + id)!)).toEqual({ generationId: id, savedAt: now, expiresAt: Date.parse(expires) });
    expect(storage.setItem).toHaveBeenCalledTimes(1);
  });

  it("still reports actual read failures as unavailable", () => {
    const storage = memoryStorage({ [HISTORY_PREFIX + id]: currentEntry });
    storage.getItem.mockImplementation(() => { throw new Error("read blocked"); });
    expect(readGenerationHistory(now, storage)).toEqual({ available: false, entries: [] });
    expect(pruneGenerationHistory(now, storage)).toBe(false);
    expect(rememberGeneration(id, expires, now, storage)).toBe(false);
    expect(storage.setItem).not.toHaveBeenCalled();
  });
});


describe("cross-window history notification", () => {
  it("changes one non-entry key without changing existing entries or storing private input", () => {
    rememberGeneration(id, expires, now);
    const original = localStorage.getItem(HISTORY_PREFIX + id);
    expect(notifyGenerationHistory()).toBe(true);
    const first = localStorage.getItem(HISTORY_PREFIX + "refresh");
    expect(first).toMatch(/^[a-f0-9-]{36}$/);
    expect(notifyGenerationHistory()).toBe(true);
    expect(localStorage.getItem(HISTORY_PREFIX + "refresh")).not.toBe(first);
    expect(localStorage.length).toBe(2);
    expect(localStorage.getItem(HISTORY_PREFIX + id)).toBe(original);
    expect(readGenerationHistory(now).entries).toEqual([JSON.parse(original!)]);
    expect(pruneGenerationHistory(now)).toBe(true);
    expect(readGenerationHistory(now).entries).toHaveLength(1);
  });
  it("tolerates blocked storage without throwing or retrying a generation", () => {
    const storage = {setItem: vi.fn(() => {throw Error("blocked");})};
    expect(notifyGenerationHistory(storage)).toBe(false);
    expect(storage.setItem).toHaveBeenCalledOnce();
  });
});
