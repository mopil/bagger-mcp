// 에러 가시화 유틸. Node fetch(undici)는 실제 원인을 error.cause에 숨기고
// 표면 메시지는 "fetch failed"처럼 무의미한 경우가 많다. 이름/메시지/코드/cause
// 체인을 모두 펼쳐 클라이언트(Claude Desktop)와 에이전트가 원인을 알 수 있게 한다.

export interface ErrorPayload {
  name: string;
  message: string;
  code?: string;
  status?: number;
  cause?: ErrorPayload;
}

function readProp(obj: unknown, key: string): unknown {
  if (obj && typeof obj === "object" && key in obj) {
    return (obj as Record<string, unknown>)[key];
  }
  return undefined;
}

export function toErrorPayload(error: unknown, depth = 0): ErrorPayload {
  if (error instanceof Error) {
    const code = readProp(error, "code");
    const status = readProp(error, "status") ?? readProp(error, "statusCode");
    const rawCause = readProp(error, "cause");
    return {
      name: error.name || "Error",
      message: error.message || String(error),
      code: typeof code === "string" || typeof code === "number" ? String(code) : undefined,
      status: typeof status === "number" ? status : undefined,
      // cause 체인은 한 단계만 펼친다(순환/과도한 깊이 방지).
      cause: rawCause !== undefined && depth < 1 ? toErrorPayload(rawCause, depth + 1) : undefined,
    };
  }
  if (typeof error === "string") {
    return { name: "Error", message: error };
  }
  try {
    return { name: "Error", message: JSON.stringify(error) };
  } catch {
    return { name: "Error", message: String(error) };
  }
}

// 사람이 읽을 한 줄 메시지. 예:
//   "TypeError: fetch failed | cause: Error: getaddrinfo ENOTFOUND ... (ENOTFOUND)"
export function formatError(error: unknown): string {
  const p = toErrorPayload(error);
  const render = (e: ErrorPayload): string => {
    const head = e.name && e.name !== "Error" ? `${e.name}: ${e.message}` : e.message;
    const tags = [e.code, e.status !== undefined ? `HTTP ${e.status}` : undefined]
      .filter(Boolean)
      .join(", ");
    return tags ? `${head} (${tags})` : head;
  };
  let out = render(p);
  if (p.cause) out += ` | cause: ${render(p.cause)}`;
  return out;
}
