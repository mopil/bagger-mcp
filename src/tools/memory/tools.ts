import type { ServiceRegistry } from "../../mcp/services.js";
import { defineServiceTool } from "../defineTool.js";
import {
  memoryBulkDeleteInputSchema,
  memoryBulkWriteInputSchema,
  memoryDeleteInputSchema,
  memoryListInputSchema,
  memoryReadInputSchema,
  memorySearchInputSchema,
  memoryWriteInputSchema,
} from "./schema.js";

const tool = defineServiceTool<ServiceRegistry>();

export const memoryTools = [
  tool({
    name: "memory_list",
    description:
      "List files and subdirectories in the memory-space GitHub repo at the given path. Omit path to list the repo root.",
    inputSchema: memoryListInputSchema,
    async run(args, { memoryService }) {
      const entries = await memoryService.list(args.path ?? undefined);
      return { entries };
    },
  }),
  tool({
    name: "memory_read",
    description:
      "Read a single file from the memory-space GitHub repo and return its UTF-8 content plus sha.",
    inputSchema: memoryReadInputSchema,
    async run(args, { memoryService }) {
      const file = await memoryService.read(args.path);
      return { file };
    },
  }),
  tool({
    name: "memory_write",
    description:
      "Create or update a file in the memory-space GitHub repo. SHA is resolved automatically: creates when the path is new, updates when it exists. commit_message is required. Before using this tool the first time in a session, call memory_read on 'CLAUDE.md' / 'README.md' and any files under '.meta/' to learn the repo's filename, directory, and frontmatter conventions — then follow them. Do not invent a new layout.",
    inputSchema: memoryWriteInputSchema,
    async run(args, { memoryService }) {
      const result = await memoryService.write(args.path, args.content, args.commit_message);
      return { result };
    },
  }),
  tool({
    name: "memory_delete",
    description:
      "Delete a file from the memory-space GitHub repo. SHA is resolved automatically. commit_message is required. Before deleting anything curated by humans (usually under 'sources/'), confirm the repo's deletion policy by reading 'CLAUDE.md' or '.meta/' first — some directories are append-only.",
    inputSchema: memoryDeleteInputSchema,
    async run(args, { memoryService }) {
      const result = await memoryService.delete(args.path, args.commit_message);
      return { result };
    },
  }),
  tool({
    name: "memory_search",
    description:
      "Full-text search across the memory-space GitHub repo via GitHub Code Search API. Optional extension and path qualifiers narrow the scope. Note: GitHub Code Search only indexes the repo's default branch, so results may not reflect other branches. Newly pushed files can take a short while to become searchable.",
    inputSchema: memorySearchInputSchema,
    async run(args, { memoryService }) {
      const result = await memoryService.search(args.query, {
        extension: args.extension ?? undefined,
        path: args.path ?? undefined,
      });
      return { result };
    },
  }),
  tool({
    name: "memory_bulk_write",
    description:
      "Create or update multiple files in a SINGLE atomic commit via the GitHub Git Data API. Prefer this over looping memory_write when changes are related — one commit keeps history clean and the operation is all-or-nothing. commit_message applies to the whole batch. Same convention rules as memory_write: read CLAUDE.md / .meta/ once per session before composing writes.",
    inputSchema: memoryBulkWriteInputSchema,
    async run(args, { memoryService }) {
      const result = await memoryService.bulkWrite(args.writes, args.commit_message);
      return { result };
    },
  }),
  tool({
    name: "memory_bulk_delete",
    description:
      "Delete multiple files in a SINGLE atomic commit via the GitHub Git Data API. All paths must exist on the branch — if any is missing the call aborts with an error BEFORE committing, so the repo is never left in a half-applied state.",
    inputSchema: memoryBulkDeleteInputSchema,
    async run(args, { memoryService }) {
      const result = await memoryService.bulkDelete(args.paths, args.commit_message);
      return { result };
    },
  }),
];
