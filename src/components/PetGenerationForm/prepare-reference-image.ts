const MAX_BYTES = 5 * 1024 * 1024;
const READ_TIMEOUT_MS = 15_000;
const IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"]);

export class ReferenceImageError extends Error {
  constructor(readonly code: "invalid" | "too_large" | "unreadable") {
    super(code);
    this.name = "ReferenceImageError";
  }
}

function checkAbort(signal: AbortSignal) {
  if (signal.aborted) throw new DOMException("Image selection cancelled", "AbortError");
}

async function readStream(file: File, signal: AbortSignal): Promise<ArrayBuffer> {
  const reader = file.stream().getReader();
  const chunks: Uint8Array[] = [];
  let length = 0, timedOut = false;
  const cancel = () => { void reader.cancel().catch(() => {}); };
  const timer = setTimeout(() => {timedOut = true; cancel();}, READ_TIMEOUT_MS);
  signal.addEventListener("abort", cancel, {once: true});
  try {
    while (true) {
      checkAbort(signal);
      const chunk = await reader.read();
      checkAbort(signal);
      if (timedOut) throw new ReferenceImageError("unreadable");
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > MAX_BYTES) {
        await reader.cancel().catch(() => {});
        throw new ReferenceImageError("too_large");
      }
      chunks.push(chunk.value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {bytes.set(chunk, offset); offset += chunk.byteLength;}
    return bytes.buffer;
  } finally {
    clearTimeout(timer);
    signal.removeEventListener("abort", cancel);
    reader.releaseLock();
  }
}

function readWithFileReader(file: File, signal: AbortSignal): Promise<ArrayBuffer> {
  if (file.size > MAX_BYTES) return Promise.reject(new ReferenceImageError("too_large"));
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      reader.onload = reader.onerror = reader.onprogress = reader.onabort = null;
    };
    const fail = (error: Error) => {
      cleanup();
      if (reader.readyState === FileReader.LOADING) reader.abort();
      reject(error);
    };
    const cancel = () => fail(new DOMException("Image selection cancelled", "AbortError"));
    const timer = setTimeout(() => fail(new ReferenceImageError("unreadable")), READ_TIMEOUT_MS);
    reader.onprogress = event => {
      if (event.loaded > MAX_BYTES || (event.lengthComputable && event.total > MAX_BYTES)) fail(new ReferenceImageError("too_large"));
    };
    reader.onerror = () => fail(reader.error ?? new ReferenceImageError("unreadable"));
    reader.onabort = cancel;
    reader.onload = () => {
      const bytes = reader.result;
      if (!bytes || typeof bytes === "string") return fail(new ReferenceImageError("unreadable"));
      if (bytes.byteLength > MAX_BYTES) return fail(new ReferenceImageError("too_large"));
      cleanup(); resolve(bytes);
    };
    signal.addEventListener("abort", cancel, {once: true});
    try {reader.readAsArrayBuffer(file);} catch (error) {
      fail(error instanceof DOMException ? error : new ReferenceImageError("unreadable"));
    }
    if (signal.aborted) cancel();
  });
}

function decodeImage(url: string, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const image = new Image();
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", cancel);
      image.onload = image.onerror = null;
    };
    const fail = (error: Error) => {cleanup(); image.src = ""; reject(error);};
    const cancel = () => fail(new DOMException("Image selection cancelled", "AbortError"));
    const timer = setTimeout(() => fail(new ReferenceImageError("unreadable")), READ_TIMEOUT_MS);
    image.onload = () => {
      if (!image.naturalWidth || !image.naturalHeight) return fail(new ReferenceImageError("unreadable"));
      cleanup(); resolve();
    };
    image.onerror = () => fail(new ReferenceImageError("unreadable"));
    signal.addEventListener("abort", cancel, {once: true});
    image.src = url;
    if (signal.aborted) cancel();
  });
}

export async function prepareReferenceImage(source: File, signal: AbortSignal): Promise<{file: File; url: string}> {
  checkAbort(signal);
  if (!IMAGE_TYPES.has(source.type)) throw new ReferenceImageError("invalid");
  let bytes: ArrayBuffer;
  for (let attempt = 0; ; attempt++) {
    try {
      // Read before inspecting source size: Android picker-backed files can fail after metadata access.
      bytes = await (typeof source.stream === "function" ? readStream(source, signal) : readWithFileReader(source, signal));
      break;
    } catch (error) {
      checkAbort(signal);
      if (attempt === 0 && error instanceof DOMException && error.name === "NotReadableError") continue;
      if (error instanceof ReferenceImageError) throw error;
      throw new ReferenceImageError("unreadable");
    }
  }
  checkAbort(signal);
  if (!bytes.byteLength) throw new ReferenceImageError("invalid");
  // Preserve the original bytes for request fingerprinting; do not re-encode the image.
  const file = new File([bytes], source.name, {type: source.type});
  const url = URL.createObjectURL(file);
  try {
    await decodeImage(url, signal);
    checkAbort(signal);
    return {file, url};
  } catch (error) {
    URL.revokeObjectURL(url);
    throw error;
  }
}
