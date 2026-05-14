"use client";

import { useEffect } from "react";

import {
  createAgentPet,
  type WebMCPPetInput,
} from "@/components/WebMCP/webmcp-utils";
import {
  registerWebMCPTools,
  toolResult,
  type WebMCPTool,
} from "@/components/WebMCP/webmcp-runtime";

type CurrentPetWebMCPToolProps = {
  pet: WebMCPPetInput;
};

const EMPTY_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
};

export function CurrentPetWebMCPTool({ pet }: CurrentPetWebMCPToolProps) {
  useEffect(() => {
    const tools: WebMCPTool[] = [
      {
        name: "get_current_codex_pet",
        title: "Get Current Codex Pet",
        description:
          "Get public metadata, asset URLs, page URL, and install command for the approved Codex pet open in this browser tab.",
        inputSchema: EMPTY_SCHEMA,
        annotations: { readOnlyHint: true, untrustedContentHint: true },
        execute: () => {
          const agentPet = createAgentPet(pet, window.location.origin);
          return toolResult(`The current Codex pet is ${agentPet.displayName}.`, {
            pet: agentPet,
          });
        },
      },
    ];

    return registerWebMCPTools(tools);
  }, [pet]);

  return null;
}
