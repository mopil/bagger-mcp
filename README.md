# bagger-mcp

투자 리서치용 데이터 소스를 하나로 묶은 MCP 서버입니다. Telegram, X(Grok), Yahoo
Finance, KRX, OpenDART, 네이버 부동산, 주요 암호화폐 거래소/CoinGecko, 장기기억
저장소를 도구로 노출하며 Claude Connector(Streamable HTTP)에서 사용합니다.

## 요구 사항

- Node.js **22 이상** (`yahoo-finance2` 호환)
- `my.telegram.org/apps`에서 발급한 Telegram API 앱
- 미리 생성한 `TELEGRAM_SESSION` 문자열
- 각 데이터 소스용 API 키 (아래 환경 변수 참고)

## 환경 변수

`.env.example`을 `.env`로 복사한 뒤 아래 값을 채웁니다.

```bash
MCP_PATH_SECRET=your-long-random-secret
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=your-telegram-api-hash
TELEGRAM_SESSION=your-string-session
XAI_API_KEY=your-xai-api-key
GITHUB_TOKEN=your-github-token
KRX_AUTH_KEY=your-krx-openapi-auth-key
DART_API_KEY=your-opendart-api-key
# 선택값
COINGECKO_API_KEY=your-coingecko-demo-key
MCP_TOOL_TIMEOUT_MS=55000
PORT=3000
```

- `KRX_AUTH_KEY`는 [KRX Data Marketplace OpenAPI](https://openapi.krx.co.kr/)에서 가입 후 활용신청 → 관리자 승인 후 발급됩니다. 일 호출 한도 10,000건, 비상업용.
- `DART_API_KEY`는 [OpenDART](https://opendart.fss.or.kr/)에서 무료 발급합니다.
- `COINGECKO_API_KEY`는 선택값입니다. 없으면 공개 엔드포인트로, 있으면 Demo 키로 호출합니다.
- `MCP_TOOL_TIMEOUT_MS`는 선택값(기본 `55000`)입니다. 클라이언트(예: Claude Desktop)의
  요청 타임아웃(기본 60초)보다 짧게 잡아, 클라이언트가 `this operation was aborted`로
  요청을 끊기 전에 서버가 실제 에러 메시지를 먼저 반환하도록 합니다.
- `PORT`는 선택값입니다. 로컬에서는 기본값 `3000`을 사용하고, Railway 배포 시에는 Railway가 자동으로 포트를 주입합니다.
- 네이버 부동산 도구는 별도 API 키가 필요 없습니다(비공식 내부 API).

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

모든 도구는 `content.text`에 JSON 문자열을 담고, 동일한 원본 데이터를 `structuredContent`로도 함께 반환합니다.
도구 실행이 실패하면 예외를 던지는 대신 `isError: true` 결과로 실제 에러 메시지를 반환합니다.

### Telegram

- `telegram_list_channels({ query?, limit? })`
  - 현재 세션에서 접근 가능한 Telegram dialog 목록을 반환합니다.
  - 각 항목에는 `id`, `title`, `username`, `type`, `accessKey`가 포함됩니다.
- `telegram_read_channels({ channels, hours?, limit? })`
  - 여러 Telegram dialog를 한 번에 읽습니다. `channels`는 `{ channel, offsetId? }[]` 형태입니다.
  - `channel`에는 username, 정확한 제목, 부분 제목, 숫자 id를 넣을 수 있습니다.
  - 각 채널 결과에는 `nextOffsetId`가 포함되어 이어 읽기가 가능하고, 일부 채널이 실패해도 전체 요청은 유지되며 실패 항목에는 `error`가 포함됩니다.

### X / Grok

- `x_search({ query, allowedXHandles?, excludedXHandles?, fromDate?, toDate? })`
  - Grok의 `x_search` built-in tool로 X 실시간 검색을 수행합니다.

### Yahoo Finance (해외 주식)

- `get_historical_stock_prices({ symbol, fromDate, toDate?, interval? })` — 일/주/월 가격 이력.
- `get_stock_info({ symbol })` — 현재 가격, 요약, 재무/밸류에이션 기본 정보.
- `get_yahoo_finance_news({ query, newsCount? })` — 뉴스 검색 결과.
- `get_stock_actions({ symbol, fromDate, toDate? })` — 배당·액면분할 이력.
- `get_financial_statement({ symbol, statementType, frequency?, fromDate, toDate? })` — 시계열 재무제표.
- `get_holder_info({ symbol })` — 기관/펀드/내부자/주요 보유자 정보.
- `get_recommendations({ symbol })` — 관련 종목 추천.

### KRX (국내 증시)

- `krx_get_kospi_index_daily({ basDd })` — KOSPI 계열 지수 시세(KOSPI200, 섹터지수 등).
- `krx_get_kosdaq_index_daily({ basDd })` — 코스닥 계열 지수 시세.
- `krx_get_stock_daily_kospi({ basDd })` — 유가증권 전종목 매매정보(시/고/저/종/거래량/시총). 스크리닝용.
- `krx_get_stock_daily_kosdaq({ basDd })` — 코스닥 전종목 매매정보.
- `krx_get_stock_base_info_kospi({ basDd })` — 유가증권 종목 메타(코드/종목명/상장일/액면가/상장주식수).
- `krx_get_stock_base_info_kosdaq({ basDd })` — 코스닥 종목 메타.
- `krx_get_etf_daily({ basDd })` — ETF 전종목 매매정보 + NAV/AUM/추적 기초지수.

`basDd`는 `YYYYMMDD` 8자리 문자열이며, 휴장일 호출 시 `rows`는 빈 배열입니다.

### OpenDART (국내 공시/재무)

- `dart_search_corp({ query, limit?, only_listed? })` — 회사명으로 고유번호(corp_code) 검색. 후속 호출의 전제. 회사코드 zip은 24h 캐시.
- `dart_list_disclosures({ corp_code, bgn_de, end_de, pblntf_ty?, page_count?, page_no? })` — 기간별 공시 목록.
- `dart_get_company({ corp_code })` — 회사 개황(대표자/설립일/주소/업종 등).
- `dart_get_financials({ corp_code, bsns_year, reprt_code?, fs_div? })` — 단일회사 전체 재무제표(2015년 이후).

### 네이버 부동산 (비공식 API)

가격 단위는 **만원**입니다(예: `79000` = 7.9억). 거래유형은 `매매`/`전세`/`월세`
또는 코드 `A1`/`B1`/`B2`를 모두 받습니다. 호출 간 간격 제어·재시도로 차단을 방지합니다.

- `naverland_resolve_district({ query })` — 지역명(동/구/군)을 네이버 `cortarNo`로 변환.
- `naverland_list_districts()` — 전국 시/도 목록(cortarNo 포함).
- `naverland_search_apartments({ district, trade_type?, price_min?, price_max?, max_complexes?, max_articles_per_complex? })`
  - 지역+가격대로 아파트 매물 검색. `max_complexes`로 크롤링 단지 수를 제한합니다.
- `naverland_search_commercial({ district, property_type?, trade_type?, deposit_max?, rent_max?, keyword?, max_pages? })`
  - 상가/사무실/공장 등 비-아파트 매물 검색. 보증금/월세 상한·키워드(전대, 스터디 등) 필터.
- `naverland_get_article_detail({ article_no, complex_no? })`
  - 개별 매물 상세. 건축물 용도(`lawUsage`, 예: "제2종 근린생활시설"), 전대차 언급 여부(`subleaseMentioned`), 전체 설명·주차·입주·건폐율/용적률 등을 반환합니다.
- `naverland_get_complex_info({ complex_id? | complex_name? })` — 단지 상세(세대수/준공일/평형/좌표).
- `naverland_get_complex_price_info({ complex_id? | complex_name? })` — 평형별 시세(상/하/평균) + 최근 실거래가.
- `naverland_watch_complexes({ complex_names, trade_type?, price_min?, price_max? })` — 관심 단지 매물 수/최저·최고가 + 직전 호출 대비 변동(세션 내 메모리 스냅샷).

> 비공식 내부 API라 네이버 구조 변경 시 동작이 바뀔 수 있고, 2종근생 용도/전대차 가능
> 여부는 매물별로 `get_article_detail`로 확인하거나 중개사 문의가 필요합니다. 개인 리서치 용도로 사용하세요.

### 암호화폐

- Upbit: `upbit_list_markets()`, `upbit_get_ticker({ markets })`, `upbit_get_candles({ market, unit?, count? })`
- Bithumb: `bithumb_list_markets()`, `bithumb_get_ticker({ markets })`, `bithumb_get_candles({ market, unit?, count? })`
- Binance: `binance_list_symbols()`, `binance_get_ticker({ symbols? })`, `binance_get_klines({ symbol, interval, limit? })`
- CoinGecko: `coingecko_get_global()`, `coingecko_get_simple_price({ ids, vs_currencies, ... })`, `coingecko_list_categories()`, `coingecko_list_coins_markets({ vs_currency, ... })`, `coingecko_search_trending()`

### 장기기억 (memory-space)

- `memory_capture({ ... })` — 원본 항목을 `sources/_inbox/`에 추가(append). 저장 후 경로를 안내합니다.
- `memory_list()` / `memory_read({ path })` / `memory_search({ query })` — 기억 저장소 조회.

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
