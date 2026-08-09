const MAX_IMAGE_BYTES = 40 * 1024 * 1024;
const MAX_PROVIDER_JSON_CHARS = 90 * 1024 * 1024;

export class OpenAIProviderError extends Error {
  constructor(message, options = {}) {
    super(message);
    this.name = "OpenAIProviderError";
    this.code = options.code ?? "provider_error";
    this.status = options.status ?? null;
    this.responseReceived = options.responseReceived ?? true;
    this.requestId = options.requestId ?? null;
  }
}

export function createOpenAIPetGenerationProvider(options) {
  const key = String(options.apiKey ?? "").trim();
  if (!key) throw new Error("OPENAI_API_KEY is required by the generation worker.");
  const base = String(options.baseUrl ?? "https://api.openai.com/v1").replace(/\/+$/, "");
  const fetchImpl = options.fetchImpl ?? fetch;

  async function moderate({ text, image }) {
    const input = [];
    if (text) input.push({ type: "text", text });
    if (image) input.push({ type: "image_url", image_url: { url: dataUrl(image) } });
    const response = await requestJson(fetchImpl, `${base}/moderations`, {
      method: "POST",
      headers: jsonHeaders(key),
      body: JSON.stringify({ model: "omni-moderation-latest", input }),
    });
    const flagged = response.body?.results?.[0]?.flagged;
    if (typeof flagged !== "boolean") throw providerError("invalid_moderation_response", "Moderation response was invalid.", response);
    return { flagged, requestId: response.requestId };
  }

  async function generateImage({ prompt, size, references = [] }) {
    let response;
    if (!references.length) {
      response = await requestJson(fetchImpl, `${base}/images/generations`, {
        method: "POST",
        headers: jsonHeaders(key),
        body: JSON.stringify({
          model: options.imageModel,
          prompt,
          size,
          quality: "high",
          output_format: "png",
          n: 1,
        }),
      });
    } else {
      const form = new FormData();
      form.set("model", options.imageModel);
      form.set("prompt", prompt);
      form.set("size", size);
      form.set("quality", "high");
      form.set("output_format", "png");
      references.forEach((value, index) =>
        form.append("image[]", new Blob([value], { type: "image/png" }), `reference-${index + 1}.png`),
      );
      response = await requestJson(fetchImpl, `${base}/images/edits`, {
        method: "POST",
        headers: { Authorization: `Bearer ${key}` },
        body: form,
      });
    }
    const encoded = response.body?.data?.[0]?.b64_json;
    if (typeof encoded !== "string" || encoded.length > MAX_IMAGE_BYTES * 2) {
      throw providerError("invalid_image_response", "Image response was invalid or too large.", response);
    }
    const image = Buffer.from(encoded, "base64");
    if (!image.length || image.length > MAX_IMAGE_BYTES || !isPng(image)) {
      throw providerError("invalid_image_response", "Image response was not a bounded PNG.", response);
    }
    return { image, requestId: response.requestId, usage: compactUsage(response.body?.usage) };
  }

  async function review({ contactSheet, directionSheet }) {
    const response = await requestJson(fetchImpl, `${base}/responses`, {
      method: "POST",
      headers: jsonHeaders(key),
      body: JSON.stringify({
        model: options.reviewModel,
        input: [
          {
            role: "system",
            content: "Review a Codex Pets v2 animation atlas. Report only visible identity, clipping, registration, direction, continuity, chroma, or animation issues. Do not perform fixes.",
          },
          {
            role: "user",
            content: [
              { type: "input_text", text: "Check all 11 rows, all frames, four cardinal anchors, and all 16 look directions. Set pass false when any error exists." },
              { type: "input_image", image_url: dataUrl(contactSheet), detail: "high" },
              { type: "input_image", image_url: dataUrl(directionSheet), detail: "high" },
            ],
          },
        ],
        reasoning: { effort: "high" },
        text: { format: { type: "json_schema", name: "codex_pet_review", strict: true, schema: reviewSchema() } },
      }),
    });
    let parsed;
    try { parsed = JSON.parse(outputText(response.body)); }
    catch { throw providerError("invalid_review_response", "Vision review response was not valid JSON.", response); }
    validateReview(parsed);
    return { review: parsed, requestId: response.requestId, usage: compactUsage(response.body?.usage) };
  }
  return { moderate, generateImage, review };
}

async function requestJson(fetchImpl, url, init) {
  let response;
  try { response = await fetchImpl(url, init); }
  catch {
    throw new OpenAIProviderError("Provider response was not received.", {
      code: "ambiguous_network_error",
      responseReceived: false,
    });
  }
  const requestId = response.headers.get("x-request-id");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_PROVIDER_JSON_CHARS) {
    throw new OpenAIProviderError("Provider response was too large.", {
      code: "invalid_provider_response", status: response.status, requestId,
    });
  }
  let text;
  try { text = await response.text(); }
  catch {
    throw new OpenAIProviderError("Provider response was interrupted.", {
      code: "ambiguous_network_error", status: response.status, responseReceived: false, requestId,
    });
  }
  if (text.length > MAX_PROVIDER_JSON_CHARS) {
    throw new OpenAIProviderError("Provider response was too large.", {
      code: "invalid_provider_response", status: response.status, requestId,
    });
  }
  let body;
  try { body = JSON.parse(text); }
  catch {
    throw new OpenAIProviderError("Provider returned invalid JSON.", {
      code: "invalid_provider_response",
      status: response.status,
      requestId,
    });
  }
  if (!response.ok) {
    const code = typeof body?.error?.code === "string" && /^[a-zA-Z0-9_.-]{1,120}$/.test(body.error.code)
      ? body.error.code
      : "provider_http_error";
    throw new OpenAIProviderError("Provider rejected the request.", { code, status: response.status, requestId });
  }
  return { body, requestId };
}

function reviewSchema() {
  return {
    type: "object",
    properties: {
      pass: { type: "boolean" },
      issues: {
        type: "array",
        maxItems: 100,
        items: {
          type: "object",
          properties: {
            row: { type: ["integer", "null"], minimum: 0, maximum: 10 },
            frame: { type: ["integer", "null"], minimum: 0, maximum: 7 },
            category: { type: "string", maxLength: 80 },
            severity: { type: "string", enum: ["warning", "error"] },
            message: { type: "string", maxLength: 300 },
          },
          required: ["row", "frame", "category", "severity", "message"],
          additionalProperties: false,
        },
      },
    },
    required: ["pass", "issues"],
    additionalProperties: false,
  };
}
function validateReview(value) {
  if (!value || typeof value !== "object" || typeof value.pass !== "boolean" ||
    !Array.isArray(value.issues) || value.issues.length > 100) {
    throw new OpenAIProviderError("Vision review response failed validation.", { code: "invalid_review_response" });
  }
  for (const issue of value.issues) {
    if (!issue || typeof issue !== "object" ||
      !(issue.row === null || Number.isInteger(issue.row) && issue.row >= 0 && issue.row <= 10) ||
      !(issue.frame === null || Number.isInteger(issue.frame) && issue.frame >= 0 && issue.frame <= 7) ||
      typeof issue.category !== "string" || issue.category.length > 80 ||
      typeof issue.message !== "string" || issue.message.length > 300 ||
      !["warning", "error"].includes(issue.severity)) {
      throw new OpenAIProviderError("Vision review issue failed validation.", { code: "invalid_review_response" });
    }
  }
  if (value.pass && value.issues.some((issue) => issue.severity === "error")) {
    throw new OpenAIProviderError("Vision review pass flag contradicted its issues.", { code: "invalid_review_response" });
  }
}
function outputText(body) {
  for (const item of body?.output ?? []) {
    for (const content of item?.content ?? []) {
      if (content?.type === "output_text" && typeof content.text === "string") return content.text;
    }
  }
  throw new OpenAIProviderError("Vision review response did not contain output text.", { code: "invalid_review_response" });
}
function compactUsage(value) {
  if (!value || typeof value !== "object") return {};
  return Object.fromEntries(["input_tokens", "output_tokens", "total_tokens", "input_tokens_details"]
    .filter((name) => value[name] !== undefined).map((name) => [name, value[name]]));
}
function providerError(code, message, response) {
  return new OpenAIProviderError(message, { code, requestId: response.requestId });
}
function jsonHeaders(key) {
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}
function dataUrl(buffer) {
  return `data:image/png;base64,${buffer.toString("base64")}`;
}
function isPng(buffer) {
  return buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
}
