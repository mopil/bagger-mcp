# bagger-mcp

Claude Connector에서 사용할 수 있는 Telegram 중심 MCP 서버입니다.

## 요구 사항

- Node.js 20 이상
- `my.telegram.org/apps`에서 발급한 Telegram API 앱
- 미리 생성한 `TELEGRAM_SESSION` 문자열

## 환경 변수

`.env.example`을 `.env`로 복사한 뒤 아래 값을 채웁니다.

```bash
MCP_PATH_SECRET=your-long-random-secret
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=your-telegram-api-hash
TELEGRAM_SESSION=your-string-session
XAI_API_KEY=your-xai-api-key
```

`PORT`는 선택값입니다. 로컬에서는 기본값 `3000`을 사용하고, Railway 배포 시에는 Railway가 자동으로 포트를 주입합니다.

`TELEGRAM_SESSION`은 서버 내부에서 생성하지 않습니다. 로컬에서 1회 생성한 뒤 최종 문자열만 `.env` 또는 Railway 환경 변수에 저장하는 방식입니다.

## `TELEGRAM_SESSION` 생성

먼저 아래 두 값만 준비합니다.

```bash
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=your-telegram-api-hash
```

그 다음 아래 명령을 실행합니다.

```bash
npm run telegram:session
```

스크립트는 아래 순서로 입력을 받습니다.

- 전화번호
- Telegram이 보낸 로그인 코드
- 2FA 비밀번호가 켜져 있다면 비밀번호 입력

2FA 비밀번호는 화면에 그대로 표시되지 않습니다.
로그인이 끝나면 `TELEGRAM_SESSION`을 출력하고, 동시에 `.env`의 `TELEGRAM_SESSION` 값도 자동으로 갱신합니다.

## 로컬 개발

```bash
npm install
npm run dev
```

엔드포인트:

- `GET /health`
- `POST /mcp/{MCP_PATH_SECRET}`
- `GET /mcp/{MCP_PATH_SECRET}` + `mcp-session-id`
- `DELETE /mcp/{MCP_PATH_SECRET}` + `mcp-session-id`

## MCP 도구

- `telegram_list_channels()`
  - 현재 세션에서 접근 가능한 Telegram dialog 목록을 반환합니다.
  - `query`, `limit`으로 결과를 줄일 수 있습니다.
  - 각 항목에는 `id`, `title`, `username`, `type`, `accessKey`가 포함됩니다.
- `telegram_read_channels({ channels, hours?, limit? })`
  - 여러 Telegram dialog를 한 번에 읽습니다.
  - `channels`는 `{ channel, offsetId? }[]` 형태입니다.
  - `channel`에는 username, 정확한 제목, 부분 제목, 숫자 id를 넣을 수 있습니다.
  - 지정한 시간 범위 내 최근 메시지를 채널별로 반환합니다.
  - 각 채널 결과에는 `nextOffsetId`가 포함되며, 다음 호출에서 같은 채널의 `offsetId`로 이어 읽을 수 있습니다.
  - 일부 채널이 실패해도 전체 요청은 유지되고, 실패한 채널 항목에는 `error`가 포함됩니다.
- `x_search({ query, allowedXHandles?, excludedXHandles?, fromDate?, toDate? })`
  - Grok의 `x_search` built-in tool로 X 실시간 검색을 수행합니다.
  - `allowedXHandles` / `excludedXHandles` / 날짜 필터로 범위를 줄일 수 있습니다.
- `get_historical_stock_prices({ symbol, fromDate, toDate?, interval? })`
  - Yahoo Finance 일/주/월 가격 이력을 반환합니다.
- `get_stock_info({ symbol })`
  - 현재 가격, 요약, 재무/밸류에이션 기본 정보를 반환합니다.
- `get_yahoo_finance_news({ query, newsCount? })`
  - Yahoo Finance 뉴스 검색 결과를 반환합니다.
- `get_stock_actions({ symbol, fromDate, toDate? })`
  - 배당과 액면분할 이력을 반환합니다.
- `get_financial_statement({ symbol, statementType, frequency?, fromDate, toDate? })`
  - 시계열 재무제표를 반환합니다.
- `get_holder_info({ symbol })`
  - 기관/펀드/내부자/주요 보유자 정보를 반환합니다.
- `get_recommendations({ symbol })`
  - 관련 종목 추천을 반환합니다.

모든 도구는 `content.text`에 JSON 문자열을 담고, 동일한 원본 데이터를 `structuredContent`로도 함께 반환합니다.

## Railway 배포

1. GitHub 저장소를 만들고 이 프로젝트를 푸시합니다.
2. Railway에서 GitHub 저장소를 연결해 프로젝트를 생성합니다.
3. `.env.example` 기준으로 환경 변수를 등록합니다.
4. 배포 후 `GET /health`가 정상 응답하는지 확인합니다.
5. Railway에서 발급된 HTTPS URL을 Claude Connector에 등록합니다.

예시 Connector 설정:

```text
URL: https://your-app.up.railway.app/mcp/{MCP_PATH_SECRET}
```
