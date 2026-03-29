import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";

import type { GrokService } from "./service.js";

const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Expected YYYY-MM-DD format");
const optionalIsoDateSchema = isoDateSchema.nullish();
const optionalHandleListSchema = z.array(z.string().min(1)).max(10).nullish();
const optionalBooleanSchema = z.boolean().nullish();

export function registerGrokTools(server: McpServer, grokService: GrokService): void {
  server.registerTool(
    "x_search",
    {
      description: "Search X in real time with Grok's x_search tool. Use handle and date filters to narrow scope and reduce result noise.",
      inputSchema: {
        query: z.string().min(1),
        allowedXHandles: optionalHandleListSchema,
        excludedXHandles: optionalHandleListSchema,
        fromDate: optionalIsoDateSchema,
        toDate: optionalIsoDateSchema,
        enableImageUnderstanding: optionalBooleanSchema,
        enableVideoUnderstanding: optionalBooleanSchema,
      },
    },
    async (args) => {
      const result = await grokService.xSearch({
        ...args,
        allowedXHandles: args.allowedXHandles ?? undefined,
        excludedXHandles: args.excludedXHandles ?? undefined,
        fromDate: args.fromDate ?? undefined,
        toDate: args.toDate ?? undefined,
        enableImageUnderstanding: args.enableImageUnderstanding ?? undefined,
        enableVideoUnderstanding: args.enableVideoUnderstanding ?? undefined,
      });

      return {
        content: [
          {
            type: "text",
            text: formatXSearchText(result.text, result.citations),
          },
        ],
        structuredContent: result,
      };
    },
  );
}

function formatXSearchText(text: string, citations: string[]): string {
  if (citations.length === 0) {
    return text;
  }

  const preview = citations.slice(0, 5).join("\n");
  const suffix = citations.length > 5 ? `\n... ${citations.length - 5} more citations in structuredContent` : "";

  return `${text}\n\nSources:\n${preview}${suffix}`;
}
