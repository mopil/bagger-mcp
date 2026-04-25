interface GrokServiceOptions {
  apiKey: string;
}

import type { XSearchParams } from "./schema.js";

export interface XSearchResult {
  [key: string]: unknown;
  model: string;
  text: string;
  citations: string[];
}

interface XaiResponsesApiResponse {
  citations?: string[];
  output?: Array<{
    type?: string;
    content?: Array<{
      type?: string;
      text?: string;
    }>;
  }>;
}

const XAI_RESPONSES_API_URL = "https://api.x.ai/v1/responses";
const DEFAULT_XAI_MODEL = "grok-4-latest";
const XAI_REQUEST_TIMEOUT_MS = 120_000;

export class GrokService {
  private readonly apiKey: string;

  constructor(options: GrokServiceOptions) {
    this.apiKey = options.apiKey;
  }

  async xSearch(params: XSearchParams): Promise<XSearchResult> {
    validateHandleFilters(params.allowedXHandles, params.excludedXHandles);
    validateDateRange(params.fromDate, params.toDate);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), XAI_REQUEST_TIMEOUT_MS);

    try {
      const response = await fetch(XAI_RESPONSES_API_URL, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${this.apiKey}`,
        },
        signal: controller.signal,
        body: JSON.stringify({
          model: DEFAULT_XAI_MODEL,
          include: ["no_inline_citations"],
          input: [
            {
              role: "user",
              content: params.query,
            },
          ],
          tools: [
            {
              type: "x_search",
              ...(params.allowedXHandles ? { allowed_x_handles: params.allowedXHandles } : {}),
              ...(params.excludedXHandles ? { excluded_x_handles: params.excludedXHandles } : {}),
              ...(params.fromDate ? { from_date: params.fromDate } : {}),
              ...(params.toDate ? { to_date: params.toDate } : {}),
              ...(params.enableImageUnderstanding !== undefined
                ? { enable_image_understanding: params.enableImageUnderstanding }
                : {}),
              ...(params.enableVideoUnderstanding !== undefined
                ? { enable_video_understanding: params.enableVideoUnderstanding }
                : {}),
            },
          ],
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`xAI API request failed (${response.status}): ${errorText}`);
      }

      const data = await response.json() as XaiResponsesApiResponse;
      const text = extractOutputText(data);

      return {
        model: DEFAULT_XAI_MODEL,
        text,
        citations: data.citations ?? [],
      };
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new Error(`xAI API request timed out after ${XAI_REQUEST_TIMEOUT_MS}ms`);
      }

      throw error;
    } finally {
      clearTimeout(timeout);
    }
  }
}

function extractOutputText(response: XaiResponsesApiResponse): string {
  const textParts = response.output
    ?.filter((item) => item.type === "message")
    .flatMap((item) => item.content ?? [])
    .filter((content) => content.type === "output_text" && typeof content.text === "string")
    .map((content) => content.text?.trim() ?? "")
    .filter((text) => text.length > 0);

  if (!textParts || textParts.length === 0) {
    throw new Error("xAI API response did not include output text.");
  }

  return textParts.join("\n\n");
}

function validateHandleFilters(
  allowedXHandles: string[] | undefined,
  excludedXHandles: string[] | undefined,
): void {
  if (allowedXHandles && excludedXHandles) {
    throw new Error("allowedXHandles and excludedXHandles cannot be set together.");
  }
}

function validateDateRange(fromDate: string | undefined, toDate: string | undefined): void {
  if (fromDate && toDate && fromDate > toDate) {
    throw new Error("fromDate must be earlier than or equal to toDate.");
  }
}
