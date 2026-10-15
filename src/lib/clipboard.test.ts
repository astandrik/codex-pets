// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { copyText } from "./clipboard";

const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard");
const originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand");
afterEach(() => {
  for (const [object, key, descriptor] of [[navigator, "clipboard", originalClipboard], [document, "execCommand", originalExecCommand]] as const) {
    if (descriptor) Object.defineProperty(object, key, descriptor);
    else Reflect.deleteProperty(object, key);
  }
  vi.restoreAllMocks();
});

it("uses the clipboard API without creating a fallback element", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined);
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
  const create = vi.spyOn(document, "createElement");
  await copyText("command --url 'https://example.test'");
  expect(writeText).toHaveBeenCalledWith("command --url 'https://example.test'");
  expect(create).not.toHaveBeenCalled();
});

it("preserves clipboard permission errors without retrying another mechanism", async () => {
  const error = new Error("permission denied");
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: vi.fn().mockRejectedValue(error) } });
  const create = vi.spyOn(document, "createElement");
  await expect(copyText("text")).rejects.toBe(error);
  expect(create).not.toHaveBeenCalled();
});

it.each(["success", "false", "throw"] as const)("cleans up fallback textarea after %s", async (outcome) => {
  Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
  const error = new Error("copy backend failed");
  const execCommand = vi.fn((command: string) => {
    expect(command).toBe("copy");
    const input = document.querySelector("textarea");
    expect(input?.value).toBe("synthetic command"); expect(input?.readOnly).toBe(true);
    if (outcome === "throw") throw error;
    return outcome === "success";
  });
  Object.defineProperty(document, "execCommand", { configurable: true, value: execCommand });
  const result = copyText("synthetic command");
  if (outcome === "success") await result;
  else if (outcome === "false") await expect(result).rejects.toThrow("copy_failed");
  else await expect(result).rejects.toBe(error);
  expect(execCommand).toHaveBeenCalledOnce(); expect(document.querySelector("textarea")).toBeNull();
});
