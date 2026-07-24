import { toPublicUrl } from "@/lib/base-path";
import { YANDEX_METRIKA_ID } from "@/lib/metrics/yandex";
import type {
  PetSearchVisualMode,
  PetVisualSearchFallbackReason,
} from "@/lib/pets/search-config";
import type {
  PetSearchFallbackReason,
  PetSearchResultMode,
} from "@/lib/pets/search-service";

const YANDEX_COLLECT_URL = "https://mc.yandex.ru/collect";
const MCP_TOOL_CALL_GOAL = "mcp_tool_call";
const PET_SEARCH_GOAL = "pet_search";
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
    | "get_card_code"
    | "get_pet_request_info";
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

export async function trackPetSearch(payload: {
  mode: PetSearchResultMode;
  fallbackReason: PetSearchFallbackReason | null;
  visualMode: PetSearchVisualMode;
  visualFallbackReason: PetVisualSearchFallbackReason | null;
  durationMs: number;
  resultCount: number;
}): Promise<void> {
  const token = process.env.YANDEX_METRIKA_MP_TOKEN?.trim();
  const clientId = process.env.YANDEX_METRIKA_MP_CLIENT_ID?.trim();
  if (!token || !clientId) return;

  try {
    await sendCollect({
      tid: String(YANDEX_METRIKA_ID),
      cid: clientId,
      t: "event",
      ea: PET_SEARCH_GOAL,
      dl: toPublicUrl("/"),
      ms: token,
      params: JSON.stringify({
        petSearch: {
          mode: payload.mode,
          durationBucket: durationBucket(payload.durationMs),
          resultCountBucket: resultCountBucket(payload.resultCount),
          fallbackReason: payload.fallbackReason ?? "none",
          visualMode: payload.visualMode,
          visualFallbackReason:
            payload.visualFallbackReason ?? "none",
        },
      }),
    });
  } catch {
    // Metrics must never affect search responses.
  }
}

function durationBucket(durationMs: number): string {
  if (durationMs < 100) return "lt_100_ms";
  if (durationMs < 500) return "100_499_ms";
  if (durationMs < 1_000) return "500_999_ms";
  return "gte_1000_ms";
}

function resultCountBucket(resultCount: number): string {
  if (resultCount <= 0) return "0";
  if (resultCount === 1) return "1";
  if (resultCount <= 5) return "2_5";
  if (resultCount <= 20) return "6_20";
  if (resultCount <= 60) return "21_60";
  return "gt_60";
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
