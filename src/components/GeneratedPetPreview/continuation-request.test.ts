import {randomUUID} from "node:crypto";
import {expect, it} from "vitest";
import * as requests from "./continuation-request";

const source = "a".repeat(64);
function storage() {
  const values = new Map<string, string>(), writes: string[] = [];
  return {values, writes, getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => {writes.push(key);values.set(key, value);},
    removeItem: (key: string) => {values.delete(key);}};
}
const input = () => ({requestId: randomUUID(), mode: "regenerate" as const, sourceRevision: "b".repeat(64), states: ["waving" as const], maxRetries: 5});

it("stores the exact input before the backwards-compatible UUID pointer", () => {
  const s = storage(), body = input();
  requests.rememberContinuationInput(s, source, body);
  expect(s.writes).toEqual([requests.CONTINUATION_PAYLOAD + source + ":" + body.requestId, requests.CONTINUATION_PENDING + source]);
  expect(JSON.parse(s.getItem(requests.CONTINUATION_PENDING + source)!)).toEqual({requestId: body.requestId});
  expect(requests.readContinuationId(s, source)).toBe(body.requestId);
  expect(requests.readContinuationInput(s, source, body.requestId)).toEqual(body);
});

it("does not invent a retry count for legacy input or UUID-only storage", () => {
  const s = storage(), full = input();
  const body = {requestId: full.requestId, mode: full.mode, sourceRevision: full.sourceRevision, states: full.states};
  requests.rememberContinuation(s, source, body.requestId);
  expect(requests.readContinuationInput(s, source, body.requestId)).toBeNull();
  requests.rememberContinuationInput(s, source, body);
  expect(requests.readContinuationInput(s, source, body.requestId)).toEqual(body);
  expect(requests.readContinuationInput(s, source, body.requestId)).not.toHaveProperty("maxRetries");
});

it.each(["invalid-json", "wrong-id", "oversized", "invalid-count", "unexpected-field"])("preserves the UUID when the snapshot is %s", problem => {
  const s = storage(), body = input();requests.rememberContinuationInput(s, source, body);
  const payload = {requestId: body.requestId, input: body};
  const raw = problem === "invalid-json" ? "{" : problem === "oversized" ? " ".repeat(4097) + JSON.stringify(payload)
    : JSON.stringify(problem === "wrong-id" ? {...payload, requestId: randomUUID()}
      : problem === "invalid-count" ? {...payload, input: {...body, maxRetries: 51}}
      : {...payload, input: {...body, prompt: "not allowed"}});
  s.values.set(requests.CONTINUATION_PAYLOAD + source + ":" + body.requestId, raw);
  expect(requests.readContinuationId(s, source)).toBe(body.requestId);
  expect(requests.readContinuationInput(s, source, body.requestId)).toBeNull();
});

it.each([1, 2])("propagates storage failure at write %s", failedWrite => {
  const s = storage(), body = input();let calls = 0;
  const set = s.setItem;s.setItem = (key, value) => {if (++calls === failedWrite) throw Error("storage unavailable");set(key, value);};
  expect(() => requests.rememberContinuationInput(s, source, body)).toThrow("storage unavailable");
  expect(requests.readContinuationId(s, source)).toBeNull();
});

it("does not delete the pointer or snapshot of another operation", () => {
  const s = storage(), first = input(), next = input();
  requests.rememberContinuationInput(s, source, first);
  requests.rememberContinuationInput(s, source, next);
  requests.clearContinuation(s, source, first.requestId);
  expect(requests.readContinuationId(s, source)).toBe(next.requestId);
  expect(requests.readContinuationInput(s, source, next.requestId)).toEqual(next);
  requests.clearContinuation(s, source, next.requestId);
  expect(s.values.size).toBe(0);
});

it.each([false, true])("preserves the pending payload after another pointer write fails (legacy: %s)", legacy => {
  const s = storage(), first = input(), next = {...input(), maxRetries: 12};
  if (legacy) {
    requests.rememberContinuation(s, source, first.requestId);
    s.values.set(requests.CONTINUATION_PAYLOAD + source, JSON.stringify({requestId: first.requestId, input: first}));
  } else requests.rememberContinuationInput(s, source, first);
  const set = s.setItem;
  s.setItem = (key, value) => {
    if (key === requests.CONTINUATION_PENDING + source) throw Error("pointer write failed");
    set(key, value);
  };
  expect(() => requests.rememberContinuationInput(s, source, next)).toThrow("pointer write failed");
  expect(requests.readContinuationId(s, source)).toBe(first.requestId);
  expect(requests.readContinuationInput(s, source, first.requestId)).toEqual(first);
});

it("clears only its own payload when an older tab has saved another operation", () => {
  const s = storage(), first = input(), next = input();
  requests.rememberContinuationInput(s, source, first);
  requests.rememberContinuation(s, source, next.requestId);
  s.values.set(requests.CONTINUATION_PAYLOAD + source, JSON.stringify({requestId: next.requestId, input: next}));
  requests.clearContinuation(s, source, first.requestId);
  expect(requests.readContinuationId(s, source)).toBe(next.requestId);
  expect(requests.readContinuationInput(s, source, next.requestId)).toEqual(next);
  requests.clearContinuation(s, source, next.requestId);
  expect(s.values.size).toBe(0);
});

it("clears a completed request even if the old shared payload is corrupt", () => {
  const s = storage(), body = input();
  requests.rememberContinuationInput(s, source, body);
  s.values.set(requests.CONTINUATION_PAYLOAD + source, "{");
  expect(requests.readContinuationInput(s, source, body.requestId)).toEqual(body);
  requests.clearContinuation(s, source, body.requestId);
  expect(requests.readContinuationId(s, source)).toBeNull();
  expect(requests.readContinuationInput(s, source, body.requestId)).toBeNull();
});
