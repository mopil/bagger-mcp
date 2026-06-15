import { ProxyAgent } from "undici";

// 프록시 URL(http://user:pass@host:port)에서 ProxyAgent를 생성한다.
// userinfo는 Proxy-Authorization(Basic)으로 분리해 넘긴다 — undici 버전 무관하게 인증 동작.
export function createProxyDispatcher(proxyUrl: string): ProxyAgent {
  const url = new URL(proxyUrl);
  const uri = `${url.protocol}//${url.host}`;
  if (url.username || url.password) {
    const creds = `${decodeURIComponent(url.username)}:${decodeURIComponent(url.password)}`;
    const token = `Basic ${Buffer.from(creds).toString("base64")}`;
    return new ProxyAgent({ uri, token });
  }
  return new ProxyAgent({ uri });
}

// 같은 프록시 URL에는 ProxyAgent를 1회만 만들어 재사용(커넥션 풀 유지). 여러 서비스가 공유 가능.
const dispatcherCache = new Map<string, ProxyAgent>();

export function getProxyDispatcher(proxyUrl?: string): ProxyAgent | undefined {
  if (!proxyUrl) return undefined;
  let dispatcher = dispatcherCache.get(proxyUrl);
  if (!dispatcher) {
    dispatcher = createProxyDispatcher(proxyUrl);
    dispatcherCache.set(proxyUrl, dispatcher);
  }
  return dispatcher;
}

// fetch init에 프록시 dispatcher를 주입한다(proxyUrl이 있을 때만). 글로벌 fetch에 그대로 전달 가능.
// 어느 서비스든 `fetch(url, withProxy({ method, headers, signal }, this.proxyUrl))` 형태로 사용.
export function withProxy(init: RequestInit, proxyUrl?: string): RequestInit {
  const dispatcher = getProxyDispatcher(proxyUrl);
  if (dispatcher) {
    (init as { dispatcher?: unknown }).dispatcher = dispatcher;
  }
  return init;
}
