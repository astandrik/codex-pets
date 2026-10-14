import * as http from "node:http";
import * as https from "node:https";
import * as tls from "node:tls";

export type OpenAIAMSOperation = "embeddings" | "responses" | "metadata-model";
const OPERATIONS = {
  embeddings: { method: "POST", path: "/v1/embeddings", timeout: 60_000 },
  responses: { method: "POST", path: "/v1/responses", timeout: 180_000 },
  "metadata-model": { method: "GET", path: "/v1/models/gpt-6.1-sol", timeout: 20_000 },
} as const;

export function validateAMSProxy(value: string): URL {
  const proxy = new URL(value);
  if (proxy.protocol !== "http:" || proxy.hostname !== "172.17.0.1" || !["18089", "18090"].includes(proxy.port) ||
      proxy.username || proxy.password || proxy.pathname !== "/" || proxy.search || proxy.hash) {
    throw new Error("openai_ams_proxy_invalid");
  }
  return proxy;
}

export function resolveOpenAIAMSOperation(operation: OpenAIAMSOperation) {
  if (!Object.hasOwn(OPERATIONS, operation)) throw new Error("openai_ams_operation_invalid");
  return OPERATIONS[operation];
}

// The caller selects an operation, never a destination. There is no direct or alternate-host fallback.
export function createAMSOpenAIJSONTransport(apiKey: string, proxyURL: string) {
  const proxy = validateAMSProxy(proxyURL);
  if (!apiKey.trim() || /[\r\n]/.test(apiKey)) throw new Error("openai_ams_key_invalid");
  return async (operation: OpenAIAMSOperation, payload?: unknown): Promise<unknown> => {
    const target = resolveOpenAIAMSOperation(operation);
    if (target.method === "GET" && payload !== undefined) throw new Error("openai_ams_get_body_forbidden");
    const body = target.method === "POST" ? JSON.stringify(payload) : undefined;
    if (target.method === "POST" && (!body || Buffer.byteLength(body) > 2 * 1024 * 1024)) {
      throw new Error("openai_ams_request_invalid");
    }
    const socket = await new Promise<tls.TLSSocket>((resolve, reject) => {
      const connect = http.request({ hostname: proxy.hostname, port: proxy.port,
        method: "CONNECT", path: "api.openai.com:443", headers: { Host: "api.openai.com:443" } });
      const timer = setTimeout(() => connect.destroy(new Error("openai_ams_connect_timeout")), 10_000);
      connect.once("error", () => { clearTimeout(timer); reject(new Error("openai_ams_proxy_unavailable")); });
      connect.once("connect", (response, raw, head) => {
        clearTimeout(timer);
        if (response.statusCode !== 200 || head.length) {
          raw.destroy(); reject(new Error("openai_ams_proxy_rejected")); return;
        }
        const encrypted = tls.connect({ socket: raw, servername: "api.openai.com", rejectUnauthorized: true });
        const tlsTimer = setTimeout(() => encrypted.destroy(new Error("openai_ams_tls_timeout")), 10_000);
        encrypted.once("secureConnect", () => { clearTimeout(tlsTimer); resolve(encrypted); });
        encrypted.once("error", () => { clearTimeout(tlsTimer); reject(new Error("openai_ams_tls_failed")); });
      });
      connect.end();
    });
    const agent = new https.Agent({ keepAlive: false });
    agent.createConnection = () => socket;
    try {
      return await new Promise<unknown>((resolve, reject) => {
        const request = https.request({ hostname: "api.openai.com", port: 443, path: target.path,
          method: target.method, agent, headers: { Authorization: `Bearer ${apiKey}`,
            ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}) } }, (response) => {
          const chunks: Buffer[] = []; let length = 0;
          response.on("data", (chunk: Buffer) => {
            length += chunk.length;
            if (length > 8 * 1024 * 1024) request.destroy(new Error("openai_ams_response_too_large"));
            else chunks.push(chunk);
          });
          response.once("error", () => reject(new Error("openai_ams_response_failed")));
          response.once("aborted", () => reject(new Error("openai_ams_outcome_unknown")));
          response.once("end", () => {
            if (response.statusCode !== 200) { reject(new Error(`openai_ams_http_${response.statusCode}`)); return; }
            try { resolve(JSON.parse(Buffer.concat(chunks).toString("utf8"))); }
            catch { reject(new Error("openai_ams_response_invalid")); }
          });
        });
        const timer = setTimeout(() => request.destroy(new Error("openai_ams_provider_timeout")), target.timeout);
        request.once("close", () => clearTimeout(timer));
        request.once("error", () => reject(new Error("openai_ams_outcome_unknown")));
        request.end(body);
      });
    } finally { agent.destroy(); socket.destroy(); }
  };
}
