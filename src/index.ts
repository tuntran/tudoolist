/**
 * Worker entry point.
 *
 * Routes:
 *   GET  /healthz          — unauthenticated liveness check
 *   POST /mcp              — MCP endpoint, `Authorization: Bearer <secret>`
 *   POST /mcp/<secret>     — same endpoint for clients that cannot send headers
 */

import type { JSONRPCMessage } from '@modelcontextprotocol/sdk/types.js';
import { authenticate } from './auth';
import { logRequest } from './log';
import { createMcpServer, SERVER_NAME, SERVER_VERSION } from './mcp-server';
import { DEFAULT_TZ } from './time';
import { WorkerTransport } from './worker-transport';

interface Env {
  /** Expected bearer token for goclaw and Claude Code. Required. */
  MCP_SECRET: string;
  /** Expected /mcp/<secret> value for Claude Desktop. Unset disables path auth. */
  MCP_PATH_SECRET?: string;
  /** Task and habit storage. */
  DB: D1Database;
  /** IANA zone all dates are resolved in. Defaults to the owner's zone. */
  APP_TZ?: string;
}

/** Where an /mcp request carried its credential, or null if this is not /mcp. */
type McpRoute = { pathSecret: string | null } | null;

function matchMcpRoute(pathname: string): McpRoute {
  if (pathname === '/mcp') return { pathSecret: null };
  if (pathname.startsWith('/mcp/')) {
    const secret = pathname.slice('/mcp/'.length);
    return secret.length > 0 ? { pathSecret: secret } : null;
  }
  return null;
}

function json(body: unknown, status = 200, headers: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

/** JSON-RPC error shaped for a client that never got as far as a valid request. */
function rpcError(status: number, code: number, message: string): Response {
  return json({ jsonrpc: '2.0', id: null, error: { code, message } }, status);
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const response = await route(request, url, env);
    logRequest(request.method, url.pathname, response.status);
    return response;
  },
};

async function route(request: Request, url: URL, env: Env): Promise<Response> {
  if (url.pathname === '/healthz') {
    return json({ ok: true, server: SERVER_NAME, version: SERVER_VERSION });
  }

  const mcp = matchMcpRoute(url.pathname);
  if (!mcp) return json({ error: 'not found' }, 404);

  if (!env.MCP_SECRET) {
    // Refuse to serve an unauthenticated MCP endpoint, ever.
    console.error('MCP_SECRET is not configured; refusing all /mcp traffic');
    return rpcError(500, -32603, 'server misconfigured');
  }

  const secrets = { bearer: env.MCP_SECRET, path: env.MCP_PATH_SECRET ?? null };
  if (!(await authenticate(request, mcp.pathSecret, secrets))) {
    return rpcError(401, -32001, 'unauthorized');
  }

  // Streamable HTTP allows a server to decline the GET/DELETE half of the
  // protocol. This one is stateless: no server-initiated streams, no sessions.
  if (request.method !== 'POST') {
    return rpcError(405, -32000, 'method not allowed; POST a JSON-RPC message');
  }

  let payload: unknown;
  try {
    payload = await request.json();
  } catch {
    return rpcError(400, -32700, 'parse error');
  }

  return handleRpc(payload, env);
}

async function handleRpc(payload: unknown, env: Env): Promise<Response> {
  const server = createMcpServer({ db: env.DB, tz: env.APP_TZ || DEFAULT_TZ });
  const transport = new WorkerTransport();
  await server.connect(transport);

  try {
    const messages = Array.isArray(payload) ? payload : [payload];
    const replies: JSONRPCMessage[] = [];

    for (const message of messages) {
      const reply = await transport.exchange(message as JSONRPCMessage);
      if (reply) replies.push(reply);
    }

    // Notifications only — nothing to send back.
    if (replies.length === 0) return new Response(null, { status: 202 });

    return json(Array.isArray(payload) ? replies : replies[0]);
  } finally {
    await server.close();
  }
}
