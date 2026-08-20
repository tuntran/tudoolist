# tudoolist

Personal task, backlog, and habit tracker where **agents are the primary client**.
Exposes a remote MCP server over Streamable HTTP so goclaw, Claude Code, and
Claude Desktop can read and write the data directly.

Runs on Cloudflare Workers. Target domain: `dooit.tuntran.com`.

Design rationale, locked decisions, and the build order live in
[`plans/reports/advise-260820-0137-tudoolist-mcp-first.md`](plans/reports/advise-260820-0137-tudoolist-mcp-first.md).

## Status

Walking skeleton. One tool (`ping`), no database yet. Nothing real gets built
until `ping` succeeds from all three clients — that gate proves transport, auth,
and the custom domain before any business logic exists.

| | |
|---|---|
| MCP endpoint | ✅ `/mcp`, Streamable HTTP, stateless |
| Auth | ✅ bearer header + path secret |
| Claude Code | ✅ verified connected against local dev |
| Claude Desktop | ⬜ needs a deployed URL |
| goclaw | ⬜ needs a deployed URL |
| D1 + real tools | ⬜ after the gate |

## Layout

```
src/index.ts             routing, JSON-RPC over POST
src/auth.ts              bearer + path secret, constant-time compare
src/mcp-server.ts        MCP server and its tools
src/worker-transport.ts  Workers Request/Response adapter for the MCP SDK
src/log.ts               path redaction
```

The MCP protocol comes from `@modelcontextprotocol/sdk`. Only the byte transport
is local, because the SDK's Streamable HTTP transport is built on node's
`http` req/res pair, which the Workers runtime does not provide.

## Routes

| Route | Auth | Notes |
|---|---|---|
| `GET /healthz` | none | liveness |
| `POST /mcp` | `Authorization: Bearer $MCP_SECRET` | goclaw, Claude Code |
| `POST /mcp/<MCP_PATH_SECRET>` | secret in path | Claude Desktop |

`GET`/`DELETE` on `/mcp` return 405: this server is stateless, so it offers no
server-initiated SSE stream and holds no sessions.

## Why two secrets

Claude Desktop's custom-connector dialog accepts only a URL and optional OAuth
client credentials — there is no header field — so a shared secret can only
reach it through the URL path.

A URL path lands in logs that application code cannot reach: wrangler prints it
locally, and Workers request logs capture it in production. Redacting our own
log lines does not change that, which is why `MCP_PATH_SECRET` is a separate
value from `MCP_SECRET`. The bearer token never enters a URL, so it never enters
those logs; the path secret does, and can be rotated by re-adding one Desktop
connector without touching anything else.

Leave `MCP_PATH_SECRET` unset to disable path auth entirely.

## Local development

```sh
npm install
cp .dev.vars.example .dev.vars     # then fill in two different secrets
npm run dev
```

Verify:

```sh
B=$(grep '^MCP_SECRET=' .dev.vars | cut -d= -f2)
INIT='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"curl","version":"0"}}}'

curl -s http://127.0.0.1:8787/healthz
curl -s -o /dev/null -w '%{http_code}\n' -XPOST http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' -d "$INIT"                      # 401
curl -s -XPOST http://127.0.0.1:8787/mcp \
  -H 'content-type: application/json' -H "Authorization: Bearer $B" \
  -d '{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"ping","arguments":{}}}'
```

`npm run typecheck` runs `tsc --noEmit`.

## Deploy

Needs a Cloudflare account with the `tuntran.com` zone. Uncomment the `routes`
block in `wrangler.jsonc` first.

```sh
npx wrangler secret put MCP_SECRET
npx wrangler secret put MCP_PATH_SECRET
npm run deploy
```

## Connect the clients

**Claude Code**

```sh
claude mcp add --transport http tudoolist https://dooit.tuntran.com/mcp \
  --header "Authorization: Bearer $MCP_SECRET"
claude mcp list
```

**Claude Desktop** — Settings → Connectors → Add custom connector. Leave the
OAuth fields empty and use the URL with the path secret:
`https://dooit.tuntran.com/mcp/<MCP_PATH_SECRET>`

**goclaw** — point it at `https://dooit.tuntran.com/mcp` with the
`Authorization: Bearer` header.
