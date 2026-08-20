/**
 * The MCP server and its tool surface.
 *
 * Tools are grouped by the thing they act on, and each group registers itself.
 * Only verbs that actually get used through a chat are exposed: there is no
 * client_delete, because nobody deletes a client by talking.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { localTime, todayIn, utcNow } from './time';
import { registerClientTools } from './tools/client';
import { registerExportTool } from './tools/export';
import { registerOverviewTool } from './tools/overview';
import { registerPaymentTools } from './tools/payment';
import { registerProjectTools } from './tools/project';
import { registerQueryTool } from './tools/query';
import { registerRepoTools } from './tools/repo';
import { registerTaskTools } from './tools/task';
import { registerTodayTool } from './tools/today';
import { ok, type ToolContext } from './tools/shared';

export const SERVER_NAME = 'tudoolist';
export const SERVER_VERSION = '0.4.0';

export function createMcpServer(ctx: ToolContext): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description:
        'Check that the tudoolist server is reachable and authenticated. ' +
        'Returns the server name, version, and the current local time with its ' +
        'zone. Use this to diagnose a connection, not to read task data.',
      inputSchema: {},
    },
    async () =>
      ok(ctx, {
        ok: true,
        server: SERVER_NAME,
        version: SERVER_VERSION,
        // Repeated outside as_of so a bare connectivity check still reads
        // clearly on its own.
        now: localTime(utcNow(), ctx.tz),
        today: todayIn(ctx.tz),
        tz: ctx.tz,
      }),
  );

  registerClientTools(server, ctx);
  registerProjectTools(server, ctx);
  registerRepoTools(server, ctx);
  registerPaymentTools(server, ctx);
  registerTaskTools(server, ctx);
  registerTodayTool(server, ctx);
  registerOverviewTool(server, ctx);
  registerQueryTool(server, ctx);
  registerExportTool(server, ctx);

  return server;
}
