"use client";

export type WebMCPStructuredContent = Record<string, unknown>;

export type WebMCPToolResult = {
  content: Array<{ type: "text"; text: string }>;
  structuredContent?: WebMCPStructuredContent;
  isError?: boolean;
};

export type WebMCPTool = {
  name: string;
  title?: string;
  description: string;
  inputSchema?: WebMCPStructuredContent;
  outputSchema?: WebMCPStructuredContent;
  annotations?: {
    readOnlyHint?: boolean;
    untrustedContentHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  execute: (input: unknown) => WebMCPToolResult | Promise<WebMCPToolResult>;
};

type ModelContext = {
  registerTool: (
    tool: WebMCPTool,
    options?: { signal?: AbortSignal },
  ) => void;
  unregisterTool?: (name: string) => void;
};

type NavigatorWithModelContext = Navigator & {
  modelContext?: ModelContext;
};

export function toolResult(
  text: string,
  structuredContent?: WebMCPStructuredContent,
): WebMCPToolResult {
  return {
    content: [{ type: "text", text }],
    structuredContent,
  };
}

export function toolError(text: string): WebMCPToolResult {
  return {
    content: [{ type: "text", text }],
    isError: true,
  };
}

export function registerWebMCPTools(tools: WebMCPTool[]): () => void {
  const modelContext = (navigator as NavigatorWithModelContext).modelContext;
  if (!modelContext) {
    return () => undefined;
  }

  const controller = new AbortController();
  const registeredTools: string[] = [];

  for (const tool of tools) {
    try {
      modelContext.registerTool(tool, { signal: controller.signal });
      registeredTools.push(tool.name);
    } catch (error) {
      if (process.env.NODE_ENV !== "production") {
        console.warn("[codex-pets][webmcp-register]", tool.name, error);
      }
    }
  }

  return () => {
    controller.abort();

    if (!modelContext.unregisterTool) {
      return;
    }

    for (const name of registeredTools) {
      try {
        modelContext.unregisterTool(name);
      } catch {
      }
    }
  };
}
