// @vitest-environment jsdom
import {act} from "react";
import {createRoot, type Root} from "react-dom/client";
import {ThemeProvider} from "@gravity-ui/uikit";
import {afterEach, beforeEach, expect, it, vi} from "vitest";
import {GenerationContinuation} from "./GenerationContinuation";
import {CONTINUATION_STATES} from "@/lib/pets/generation/continuation-model";
import {CONTINUATION_PENDING, CONTINUATION_PAYLOAD, readContinuationInput, rememberContinuation, rememberContinuationInput} from "./continuation-request";

const {push} = vi.hoisted(() => ({push: vi.fn()}));
vi.mock("next/navigation", () => ({useRouter: () => ({push})}));
(globalThis as {IS_REACT_ACT_ENVIRONMENT?: boolean}).IS_REACT_ACT_ENVIRONMENT = true;
window.matchMedia ??= (() => ({matches: false, addEventListener() {}, removeEventListener() {}})) as typeof window.matchMedia;
const id = "a".repeat(64), revision = "f".repeat(64);
const options = () => ({sourceRevision: revision, regenerationRetries: {min: 0, default: 5, max: 50},
  canRebuild: true, canRegenerate: true, requiredStates: ["waving"], rebuildsRemaining: 3, issues: [],
  strips: CONTINUATION_STATES.map(state => ({state, status: state === "waving" ? "missing" : "saved", uncertain: false}))});
const response = (value: unknown, status = 200) => ({ok: status < 400, status, json: async () => value});
let root: Root, host: HTMLDivElement;
const fetchMock = vi.fn();
const button = (text: string) => [...host.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === text)!;
const field = () => host.querySelector<HTMLInputElement>('[aria-label="Автоповторы при ошибке"]')!;
const submit = () => host.querySelector<HTMLButtonElement>("[data-continuation-submit]")!;
async function render(theme: "light" | "dark" = "light", enabled = true) {
  await act(async () => root.render(<ThemeProvider theme={theme}><GenerationContinuation generationId={id} enabled={enabled} onContinued={() => {}}/></ThemeProvider>));
}
async function open() {await render();await act(async () => button("Продолжить генерацию").click());}
async function enter(value: string) {
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(field(), value);
    field().dispatchEvent(new Event("input", {bubbles: true}));
  });
}
beforeEach(() => {
  localStorage.clear();host = document.createElement("div");document.body.append(host);root = createRoot(host);
  fetchMock.mockReset();push.mockReset();vi.stubGlobal("fetch", fetchMock);
  fetchMock.mockResolvedValue(response({options: options()}));
});
afterEach(async () => {await act(async () => root.unmount());host.remove();vi.restoreAllMocks();vi.unstubAllGlobals();});

it("keeps the draft count through modes, refresh, theme and resize without creating an operation", async () => {
  const uuid = vi.spyOn(crypto, "randomUUID");
  await open();expect(field().value).toBe("5");expect(host.textContent).toContain("До 6 попыток");
  await act(async () => host.querySelector<HTMLButtonElement>('[aria-label="Увеличить число автоповторов"]')!.click());
  expect(field().value).toBe("6");
  await enter("12");
  await act(async () => host.querySelector<HTMLInputElement>('input[value="rebuild"]')!.click());
  expect(field()).toBeNull();
  await act(async () => host.querySelector<HTMLInputElement>('input[value="regenerate"]')!.click());
  await act(async () => button("Обновить изображения").click());await render("dark");
  await act(async () => window.dispatchEvent(new Event("resize")));
  await act(async () => button("Закрыть").click());
  await act(async () => button("Продолжить генерацию").click());
  expect(field().value).toBe("12");expect(host.textContent).toContain("До 13 попыток");
  expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  expect(uuid).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
});

it.each(["", "-1", "51", "1.5"])("blocks invalid count %s without UUID or POST", async value => {
  const uuid = vi.spyOn(crypto, "randomUUID");await open();await enter(value);
  expect(submit().disabled).toBe(true);await act(async () => submit().click());
  expect(uuid).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
  expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
});

it("restores the frozen full request after reload and retries the identical body", async () => {
  fetchMock.mockImplementation(async (url, init) => init?.method === "POST" ? Promise.reject(Error("lost response"))
    : String(url).includes("requestId=") ? response({code: "not_found"}, 404) : response({options: options()}));
  await open();await enter("8");await act(async () => submit().click());
  const first = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1].body;
  expect(JSON.parse(first).maxRetries).toBe(8);
  expect(readContinuationInput(localStorage, id, JSON.parse(first).requestId)).toEqual(JSON.parse(first));
  await act(async () => root.unmount());root = createRoot(host);
  const uuid = vi.spyOn(crypto, "randomUUID");await render();
  expect(field().value).toBe("8");expect(field().disabled).toBe(true);
  await act(async () => button("Проверить запрос").click());
  await act(async () => button("Повторить тот же запрос").click());
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts[1][1].body).toBe(first);expect(uuid).not.toHaveBeenCalled();
});

it.each([1, 2])("does not POST when snapshot/pointer write %s fails", async failedWrite => {
  await open();let writes = 0;
  const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (++writes === failedWrite) throw Error("blocked storage");set.call(this, key, value);
  });
  await act(async () => submit().click());
  expect(host.textContent).toContain("Запрос не отправлен");
  expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
  expect(field().value).toBe("5");
});

it("does not accumulate snapshots after repeated pointer failures and later acceptance", async () => {
  fetchMock.mockImplementation(async (_url, init) => {
    if (init?.method !== "POST") return response({options: options()});
    const body = JSON.parse(init.body), generationId = "c".repeat(64);
    return response({operation: {id: body.requestId, mode: "regenerate", state: "accepted", generationId},
      generation: {generationId, status: "queued", expiresAt: new Date(Date.now() + 3600000).toISOString()}}, 202);
  });
  await open();await enter("8");
  let blockPointer = true;
  const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (blockPointer && key === CONTINUATION_PENDING + id) throw Error("pointer unavailable");
    set.call(this, key, value);
  });
  for (let attempt = 0; attempt < 2; attempt++) await act(async () => submit().click());
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(0);
  expect(localStorage.getItem(CONTINUATION_PENDING + id)).toBeNull();
  expect(field().value).toBe("8");
  blockPointer = false;
  await act(async () => submit().click());
  const posts = fetchMock.mock.calls.filter(([, init]) => init?.method === "POST");
  expect(posts).toHaveLength(1);
  expect(JSON.parse(posts[0][1].body).maxRetries).toBe(8);
  expect(push).toHaveBeenCalledWith("/generated/" + "c".repeat(64));
  expect(localStorage.getItem(CONTINUATION_PENDING + id)).toBeNull();
  const payloads = Object.keys(localStorage).filter(key => key.startsWith(CONTINUATION_PAYLOAD + id));
  expect(payloads).toEqual([]);
});

it("does not POST or lose the draft if both pointer save and rollback fail", async () => {
  await open();await enter("12");
  const set = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
    if (key === CONTINUATION_PENDING + id) throw Error("pointer unavailable");
    set.call(this, key, value);
  });
  vi.spyOn(Storage.prototype, "removeItem").mockImplementation(() => {throw Error("remove unavailable");});
  await act(async () => submit().click());
  expect(host.textContent).toContain("Запрос не отправлен");
  expect(field().value).toBe("12");expect(field().disabled).toBe(false);
  expect(localStorage.getItem(CONTINUATION_PENDING + id)).toBeNull();
  expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
});

it.each([undefined, 0, 50])("restores unknown recovery with its explicit old retry setting: %s", async maxRetries => {
  const uuid = crypto.randomUUID();rememberContinuation(localStorage, id, uuid);
  fetchMock.mockImplementation(async (url, init) => init?.method === "POST" ? Promise.reject(Error("lost"))
    : String(url).includes("requestId=") ? response({code: "not_found"}, 404) : response({options: options()}));
  await render();await act(async () => button("Проверить запрос").click());
  await act(async () => button("Обновить изображения").click());
  expect(field().value).toBe("");
  const confirm = () => host.querySelector<HTMLInputElement>(".generation-recovery__manual input")!;
  await act(async () => confirm().click());
  expect(button("Повторить тот же запрос").disabled).toBe(true);
  if (maxRetries === undefined) await act(async () => host.querySelector<HTMLInputElement>('[aria-label="В запросе не было настройки автоповторов"]')!.click());
  else await enter(String(maxRetries));
  await act(async () => confirm().click());
  await act(async () => button("Повторить тот же запрос").click());
  const body = JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1].body);
  expect(body.requestId).toBe(uuid);
  if (maxRetries === undefined) expect(body).not.toHaveProperty("maxRetries");
  else expect(body.maxRetries).toBe(maxRetries);
});

it.each([false, true])("restores server preparation input even if storage is blocked: %s", async blocked => {
  const requestId = crypto.randomUUID();rememberContinuation(localStorage, id, requestId);
  const input = {requestId, mode: "regenerate", sourceRevision: revision, states: ["waving"], maxRetries: 9};
  if (blocked) vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {throw Error("blocked");});
  fetchMock.mockResolvedValue(response({operation: {id: requestId, mode: "regenerate", state: "preparing"}, input}));
  await render();await act(async () => button("Проверить запрос").click());
  expect(field().value).toBe("9");expect(field().disabled).toBe(true);
  expect(localStorage.getItem(CONTINUATION_PENDING + id)).toBe(JSON.stringify({requestId}));
  if (blocked) expect(host.textContent).toContain("Не закрывайте страницу");
  else expect(readContinuationInput(localStorage, id, requestId)).toEqual(input);
  expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
});

it("keeps a different tab's pending operation when this one is accepted", async () => {
  let finish: (value: unknown) => void = () => {};
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? new Promise(resolve => {finish = resolve;}) : response({options: options()}));
  await open();await act(async () => submit().click());
  const sent = JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1].body);
  const other = {...sent, requestId: crypto.randomUUID(), maxRetries: 7};rememberContinuationInput(localStorage, id, other);
  await act(async () => finish(response({operation: {id: sent.requestId, mode: "regenerate", state: "accepted", generationId: "b".repeat(64)},
    generation: {generationId: "b".repeat(64), expiresAt: new Date(Date.now() + 100000).toISOString(), status: "queued"}})));
  expect(JSON.parse(localStorage.getItem(CONTINUATION_PENDING + id)!)).toEqual({requestId: other.requestId});
  expect(readContinuationInput(localStorage, id, other.requestId)).toEqual(other);
});

it("restores the first tab's exact request after the second tab cannot save its pointer", async () => {
  fetchMock.mockImplementation(async (url, init) => init?.method === "POST" ? Promise.reject(Error("lost response"))
    : String(url).includes("requestId=") ? response({code: "not_found"}, 404) : response({options: options()}));
  await open();await enter("12");
  const firstHost = document.createElement("div");document.body.append(firstHost);
  const firstRoot = createRoot(firstHost);
  try {
    await act(async () => firstRoot.render(<GenerationContinuation generationId={id} enabled onContinued={() => {}}/>));
    await act(async () => [...firstHost.querySelectorAll<HTMLButtonElement>("button")].find(b => b.textContent === "Продолжить генерацию")!.click());
    await act(async () => {
      const input = firstHost.querySelector<HTMLInputElement>('[aria-label="Автоповторы при ошибке"]')!;
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "8");
      input.dispatchEvent(new Event("input", {bubbles: true}));
    });
    await act(async () => firstHost.querySelector<HTMLButtonElement>("[data-continuation-submit]")!.click());
    const first = fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1].body;
    const set = Storage.prototype.setItem;
    const pointerFailure = vi.spyOn(Storage.prototype, "setItem").mockImplementation(function (this: Storage, key, value) {
      if (key === CONTINUATION_PENDING + id) throw Error("pointer unavailable");
      set.call(this, key, value);
    });
    await act(async () => submit().click());
    pointerFailure.mockRestore();
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
    await act(async () => root.unmount());root = createRoot(host);
    await render("dark");
    expect(field().value).toBe("8");expect(field().disabled).toBe(true);
    await act(async () => button("Проверить запрос").click());
    await act(async () => button("Повторить тот же запрос").click());
    expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")[1][1].body).toBe(first);
  } finally {await act(async () => firstRoot.unmount());firstHost.remove();}
});

it.each([
  {count: undefined, text: "Используется прежняя политика сервиса."},
  {count: 0, text: "Одна попытка, без автоповторов."},
  {count: 5, text: "До 6 попыток"},
  {count: 50, text: "До 51 попытки"},
])("shows the frozen retry policy after lost response and reload: $count", async ({count, text}) => {
  const {regenerationRetries, ...legacyOptions} = options();
  fetchMock.mockImplementation(async (_url, init) => init?.method === "POST" ? Promise.reject(Error("lost response"))
    : response({options: count === undefined ? legacyOptions : {...legacyOptions, regenerationRetries}}));
  await open();
  if (count === undefined) expect(field()).toBeNull();
  else await enter(String(count));
  await act(async () => submit().click());
  const sent = JSON.parse(fetchMock.mock.calls.find(([, init]) => init?.method === "POST")![1].body);
  if (count === undefined) expect(sent).not.toHaveProperty("maxRetries");
  else expect(sent.maxRetries).toBe(count);
  expect(host.textContent).toContain(text);
  expect(field().value).toBe(count === undefined ? "" : String(count));expect(field().disabled).toBe(true);
  await render("dark");await act(async () => window.dispatchEvent(new Event("resize")));
  expect(host.textContent).toContain(text);
  await act(async () => root.unmount());root = createRoot(host);await render();
  expect(host.textContent).toContain(text);
  expect(field().value).toBe(count === undefined ? "" : String(count));
  expect(fetchMock.mock.calls.filter(([, init]) => init?.method === "POST")).toHaveLength(1);
});

it("recovers an accepted operation after source expiry without a POST", async () => {
  const body = {requestId: crypto.randomUUID(), mode: "regenerate" as const, sourceRevision: revision, states: ["waving" as const], maxRetries: 50};
  rememberContinuationInput(localStorage, id, body);
  fetchMock.mockResolvedValue(response({operation: {id: body.requestId, mode: "regenerate", state: "accepted", generationId: "b".repeat(64)},
    generation: {generationId: "b".repeat(64), expiresAt: new Date(Date.now() + 100000).toISOString(), status: "queued"}}));
  await render("light", false);await act(async () => button("Проверить запрос").click());
  expect(push).toHaveBeenCalledWith("/generated/" + "b".repeat(64));
  expect(localStorage.getItem(CONTINUATION_PENDING + id)).toBeNull();
  expect(fetchMock.mock.calls.every(([, init]) => init?.method !== "POST")).toBe(true);
});
