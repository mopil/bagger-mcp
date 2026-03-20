# bagger-mcp

Telegram-first MCP aggregator server for Claude connectors.

## Requirements

- Node.js 20+
- A Telegram API app from `my.telegram.org/apps`
- A pre-generated `TELEGRAM_SESSION` string

## Environment variables

Copy `.env.example` to `.env` and fill these values:

```bash
MCP_API_KEY=your-random-api-key
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=your-telegram-api-hash
TELEGRAM_SESSION=your-string-session
ALLOWED_ORIGINS=https://claude.ai
```

`PORT` is optional. The server defaults to `3000` locally and Railway will inject its own port in deployment.
`ALLOWED_ORIGINS` is optional but recommended in deployment. Use a comma-separated list of allowed browser origins. Requests without an `Origin` header are still allowed for non-browser clients.

`TELEGRAM_SESSION` is intentionally managed outside the server. Generate it once with a separate local script or REPL login flow, then store the final string in Railway.

## Generate `TELEGRAM_SESSION`

Set only these values first:

```bash
TELEGRAM_API_ID=123456
TELEGRAM_API_HASH=your-telegram-api-hash
```

Then run:

```bash
npm run telegram:session
```

The script will prompt for:

- phone number
- login code sent by Telegram
- 2FA password if enabled, entered without echo

It will print a `TELEGRAM_SESSION` string. Save that into `.env` or Railway and do not commit it.

## Local development

```bash
npm install
npm run dev
```

Endpoints:

- `GET /health`
- `POST /mcp` with header `x-api-key: {MCP_API_KEY}`
- `GET /mcp` with headers `x-api-key` and `mcp-session-id`
- `DELETE /mcp` with headers `x-api-key` and `mcp-session-id`

## MCP tools

- `telegram_list_channels()`
  - Returns all visible Telegram dialogs with `id`, `title`, `username`, `type`, and `accessKey`
- `telegram_read_channel({ channel, hours?, limit? })`
  - Resolves a dialog by username, exact title, partial title, or numeric id
  - Returns recent messages within the requested time window

Both tools return a human-readable text summary plus structured JSON content.

## Railway deployment

1. Create a GitHub repository and push this project.
2. Create a Railway project from the GitHub repo.
3. Add the environment variables from `.env.example`.
4. Deploy and verify `GET /health`.
5. Use the Railway HTTPS URL in Claude.

Example connector settings:

```text
URL: https://your-app.up.railway.app/mcp
Header: x-api-key: {MCP_API_KEY}
```
