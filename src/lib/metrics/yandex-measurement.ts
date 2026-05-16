import { toPublicUrl } from "@/lib/base-path";
import { YANDEX_METRIKA_ID } from "@/lib/metrics/yandex";

const YANDEX_COLLECT_URL = "https://mc.yandex.ru/collect";
const MCP_TOOL_CALL_GOAL = "mcp_tool_call";
const COLLECT_TIMEOUT_MS = 1000;

export type McpToolCallStatus =
  | "success"
  | "invalid_argument"
  | "not_found"
  | "error";

export type McpToolCallPayload = {
  tool:
    | "search_pets"
    | "get_pet"
    | "get_install_instructions"
    | "get_badge_code"
    | "get_embed_code"
    | "get_card_code";
  status: McpToolCallStatus;
  kind?: "all" | "creature" | "object" | "character";
  hasQuery?: boolean;
  resultCount?: number;
  limit?: number;
  slug?: string;
};

export async function trackMcpToolCall(
  payload: McpToolCallPayload,
): Promise<void> {
  const token = process.env.YANDEX_METRIKA_MP_TOKEN?.trim();
  const clientId = process.env.YANDEX_METRIKA_MP_CLIENT_ID?.trim();

  if (!token || !clientId) {
    return;
  }

  try {
    const mcpUrl = toPublicUrl("/mcp");

    await sendCollect({
      tid: String(YANDEX_METRIKA_ID),
      cid: clientId,
      t: "pageview",
      dl: mcpUrl,
      dt: "Codex Pets MCP",
      dr: toPublicUrl("/"),
      ms: token,
    });
    await sendCollect({
      tid: String(YANDEX_METRIKA_ID),
      cid: clientId,
      t: "event",
      ea: MCP_TOOL_CALL_GOAL,
      dl: mcpUrl,
      ms: token,
      params: JSON.stringify({
        mcp: payload,
      }),
    });
  } catch {
    // Metrics must never affect MCP responses.
  }
}

async function sendCollect(params: Record<string, string>): Promise<void> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), COLLECT_TIMEOUT_MS);

  try {
    const response = await fetch(YANDEX_COLLECT_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded;charset=UTF-8",
      },
      body: new URLSearchParams(params),
      signal: controller.signal,
    });

    if (!response.ok) {
      return;
    }
  } catch {
    // ignore metrics failures
  } finally {
    clearTimeout(timeout);
  }
}
