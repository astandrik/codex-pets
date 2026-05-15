import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";

import { isAllowedMcpOrigin } from "@/lib/pets/mcp-origin";
import { createCodexPetsMcpServer } from "@/lib/pets/mcp-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request): Promise<Response> {
  if (!isAllowedMcpOrigin(req.headers.get("origin"))) {
    return jsonRpcError(403, -32000, "Forbidden origin.");
  }

  const server = createCodexPetsMcpServer();
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  try {
    await server.connect(transport);
    return await transport.handleRequest(req);
  } catch {
    return jsonRpcError(500, -32603, "Internal server error.");
  } finally {
    await transport.close();
    await server.close();
  }
}

export async function GET(): Promise<Response> {
  return methodNotAllowed();
}

export async function DELETE(): Promise<Response> {
  return methodNotAllowed();
}

function methodNotAllowed(): Response {
  return jsonRpcError(405, -32000, "Method not allowed.", {
    Allow: "POST",
  });
}

function jsonRpcError(
  status: number,
  code: number,
  message: string,
  headers: HeadersInit = {},
): Response {
  return Response.json(
    {
      jsonrpc: "2.0",
      error: {
        code,
        message,
      },
      id: null,
    },
    {
      status,
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
    },
  );
}
