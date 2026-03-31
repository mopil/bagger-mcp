import type { z } from "zod";

export interface ToolResponse {
  [key: string]: unknown;
  content: Array<{
    type: "text";
    text: string;
  }>;
  structuredContent?: Record<string, unknown>;
}

export interface ToolDefinition<TServices, TInputSchema extends z.ZodRawShape = z.ZodRawShape> {
  name: string;
  description: string;
  inputSchema: TInputSchema;
  execute: (args: z.infer<z.ZodObject<TInputSchema>>, services: TServices) => Promise<ToolResponse>;
}

export interface ServiceToolDefinition<
  TServices,
  TInputSchema extends z.ZodRawShape,
  TResult extends Record<string, unknown>,
> {
  name: string;
  description: string;
  inputSchema: TInputSchema;
  run: (args: z.infer<z.ZodObject<TInputSchema>>, services: TServices) => Promise<TResult>;
}

export function defineTool<TServices>() {
  return function withInputSchema<TInputSchema extends z.ZodRawShape>(
    tool: ToolDefinition<TServices, TInputSchema>,
  ): ToolDefinition<TServices, TInputSchema> {
    return tool;
  };
}

export function defineServiceTool<TServices>() {
  return function withInputSchema<
    TInputSchema extends z.ZodRawShape,
    TResult extends Record<string, unknown>,
  >(
    tool: ServiceToolDefinition<TServices, TInputSchema, TResult>,
  ): ToolDefinition<TServices, TInputSchema> {
    return {
      name: tool.name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      async execute(args, services) {
        const result = await tool.run(args, services);
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(result),
            },
          ],
          structuredContent: result,
        };
      },
    };
  };
}
