/**
 * The MCP server and its tool surface.
 *
 * Right now this holds exactly one tool. That is deliberate: nothing real gets
 * built until `ping` has been called successfully from all three clients
 * (goclaw, Claude Code, Claude Desktop), which proves transport, auth, and the
 * custom domain all work. The task/habit tools land after that gate.
 */

import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

export const SERVER_NAME = 'tudoolist';
export const SERVER_VERSION = '0.1.0';

export function createMcpServer(): McpServer {
  const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });

  server.registerTool(
    'ping',
    {
      title: 'Ping',
      description:
        'Check that the tudoolist server is reachable and authenticated. ' +
        'Returns the server name, version, and current UTC time. ' +
        'Use this to diagnose a connection, not to read any task or habit data.',
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: 'text' as const,
          text: JSON.stringify({
            ok: true,
            server: SERVER_NAME,
            version: SERVER_VERSION,
            now: new Date().toISOString(),
          }),
        },
      ],
    }),
  );

  return server;
}
