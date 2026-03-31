import { defineServiceTool } from "../defineTool.js";
import type { ServiceRegistry } from "../../mcp/services.js";
import { toXSearchParams, xSearchInputSchema } from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

export const grokTools = [
  tool({
    name: "x_search",
    description: "Search X in real time with Grok's x_search tool. Use handle and date filters to narrow scope and reduce result noise.",
    inputSchema: xSearchInputSchema,
    run(args, { grokService }) {
      return grokService.xSearch(toXSearchParams(args));
    },
  }),
];
