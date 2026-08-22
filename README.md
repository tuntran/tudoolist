# tudoolist

Personal client, project, and task tracker where **agents are the primary
client**. Exposes a remote MCP server over Streamable HTTP so goclaw, Claude
Code, and Claude Desktop can read and write the data directly.

Runs on Cloudflare Workers. Target domain: `dooit.tuntran.com`.

Design rationale, locked decisions, and the build order live in
[`plans/reports/advise-260820-0137-tudoolist-mcp-first.md`](plans/reports/advise-260820-0137-tudoolist-mcp-first.md).

## Status

In use. Seventeen tools over `client` → `project` → `task`, plus a `payment`
log, backed by D1 and live on the custom domain. The data in it is mock.

| | |
|---|---|
| MCP endpoint | ✅ `/mcp`, Streamable HTTP, stateless |
| Auth | ✅ bearer header + path secret |
| Deployed | ✅ live at `dooit.tuntran.com` |
| Claude Code | ✅ verified against production |
| Claude Desktop | ✅ verified through the connector |
| goclaw | ⏸ deferred — owner will wire and verify it separately |
| D1 + tools | ✅ 4 tables, 17 tools |
| Habits | ⬜ cut from v1, lands as its own migration |
| Real data | ⬜ mock rows for now |

## Tools

Amounts are whole VND. Dates are local calendar days (`YYYY-MM-DD`) in `APP_TZ`,
never timestamps. Every result carries an `as_of` block with the current local
time, today's date, the zone, and the UTC instant — so a caller never has to
guess which day the server means.

| Tool | |
|---|---|
| `ping` | reachable and authenticated, plus the current local time |
| `client_list` | clients, project counts, outstanding balance |
| `client_add` | name, optional note, and any of phone, Telegram, Zalo, Facebook |
| `client_update` | fill in a contact handle that was not known at the time |
| `project_list` | filter by client or status; includes what is still owed and repo URLs |
| `project_add` | needs a client id |
| `project_update` | rename, restatus, change the agreed price, edit description, note, or repos |
| `payment_add` | record money that just arrived — the amount received, not a new total |
| `payment_list` | payment history, filterable by project, client, or month |
| `task_list` | filter by project, client, status, due date. Hides done tasks by default |
| `task_add` | title alone is enough |
| `task_update` | pass `null` to clear `due_date`, `note`, or `project_id` |
| `task_done` | the common verb, idempotent |
| `today` | overdue, due today, in progress, due within 7 days, money owed — in one call |
| `overview` | monthly and running figures: income, outstanding, projects, tasks, per-client, last 6 months |
| `query` | one read-only `SELECT`, for whatever the tools above do not cover |
| `export` | whole database as JSON or replayable `INSERT` statements |

### Money is a log, not a total

A project has no `amount_paid` column. Each payment is a row in `payment` with
the local date it arrived, and the paid total is `SUM(payment.amount)`.

Storing a running total answers "how much has this client paid" and destroys
everything else: overwrite 8000000 with 13000000 and the fact that 5 triệu
arrived on a particular day is gone, so no report can ever recover it. Same
reason streaks are derived from check-ins rather than kept in a column.

Correcting a mistake means adding a negative row, not editing the old one, so
what was believed at the time survives.

### One client, several handles

A client is reached on whichever channel they actually answer: `phone`,
`telegram`, `zalo`, or `facebook`. All four are nullable columns on `client`,
and most people have one or two — a client who only ever chốt đơn over Zalo may
have no phone number stored at all.

They are separate columns rather than a JSON blob because the set of channels is
small, fixed, and named, which keeps the schema self-describing for an agent and
makes "who has a Zalo" a plain `WHERE`. Values are stored as given — a handle, a
number, or a profile URL — since normalising them would only guess wrong.

### description vs note

`description` is what the project is — the scope. `note` is where it stands
right now. They started as one field, and one kept overwriting the other,
because scope is written once and status changes weekly.

`project.repos` is a JSON array of repo URLs — a project routinely spans a
frontend and an API. It started as a table with an id, a label and a timestamp
per link; none of that was ever read, so it collapsed into a list. Set it
through `project_add`/`project_update` by sending the complete list, which
replaces what is stored. In `query`, unnest it with `json_each(project.repos)`.

### Reading vs guessing

`overview` computes its figures in SQL. The alternative — listing rows and
letting the model add them up — costs tokens proportional to the data and gets
arithmetic wrong in ways that read as confident.

`query` covers the rest. It rejects anything that is not a single `SELECT` or
`WITH`: comments are stripped before the check, a statement separator is
refused, and D1 executes one statement per call regardless. SQLite has no
data-modifying CTE, so `WITH` cannot smuggle a write in either.

## Layout

```
src/index.ts             routing, JSON-RPC over POST
src/auth.ts              bearer + path secret, constant-time compare
src/mcp-server.ts        MCP server, registers every tool group
src/db.ts                D1 helpers; partial UPDATE and optional WHERE builders
src/time.ts              local calendar dates, APP_TZ, UTC→local SQL offset
src/tools/               one module per entity, plus today, overview, query, export
src/worker-transport.ts  Workers Request/Response adapter for the MCP SDK
src/log.ts               path redaction
migrations/              numbered SQL, applied with wrangler
seeds/mock.sql           invented rows, re-runnable
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
npm run db:migrate                 # create the tables in the local D1
npm run db:seed                    # optional: mock rows to work against
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

## Database

Migrations are numbered SQL files applied by wrangler — no ORM, no migration
framework, because four tables do not need one.

| Command | |
|---|---|
| `npm run db:migrate` | apply migrations locally |
| `npm run db:migrate:remote` | apply them to production |
| `npm run db:seed` | load `seeds/mock.sql` locally (wipes every table first) |
| `npm run db:backup` | dump production to `backup.sql` (gitignored: real names and amounts) |

There is deliberately no seed script for production. Production holds real
client work, and seeding wipes every table before it inserts.

`APP_TZ` in `wrangler.jsonc` decides what "today" means. It is a var rather than
a constant so it can follow whoever uses the server; `Asia/Saigon` and
`Asia/Ho_Chi_Minh` are the same zone under two IANA names.

## Deploy

Needs a Cloudflare account with the `tuntran.com` zone.

```sh
npx wrangler secret put MCP_SECRET
npx wrangler secret put MCP_PATH_SECRET
npm run db:migrate:remote
npm run deploy
```

## Connect the clients

**Claude Code**

```sh
claude mcp add --transport http tudoolist https://dooit.tuntran.com/mcp \
  --header "Authorization: Bearer $MCP_SECRET"
claude mcp list
```

**Claude Desktop**

1. Settings → Connectors → **Add custom connector**
2. **Name**: `tudoolist`
3. **Remote MCP server URL**: `https://dooit.tuntran.com/mcp/<MCP_PATH_SECRET>`
   — the path secret is the whole credential here
4. Open **Advanced settings** and leave **OAuth Client ID** and **OAuth Client
   Secret** empty. This server does not speak OAuth; filling them in makes
   Desktop attempt a flow that will fail.
5. **Add**, then confirm `ping` shows up in the connector's tool list.

Desktop needs a public HTTPS URL — it cannot reach `localhost` through this
dialog, so it is the one client that cannot be tested before deploying.

Rotating the path secret means editing this connector's URL and nothing else.

**goclaw** — point it at `https://dooit.tuntran.com/mcp` with the
`Authorization: Bearer` header.
