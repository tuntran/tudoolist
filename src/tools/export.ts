/**
 * Whole-database export, as a tool rather than only a CLI command, so the data
 * can be pulled out from a chat without a terminal — the point of owning it.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { rows } from '../db';
import { ok, type ToolContext } from './shared';

/** Parent before child, so the dump can be replayed against an empty database. */
const TABLES = ['client', 'project', 'task', 'payment'] as const;

/** SQL literal for a value D1 can return: text, number, or null. */
function literal(value: unknown): string {
  if (value === null || value === undefined) return 'NULL';
  if (typeof value === 'number') return String(value);
  return `'${String(value).replace(/'/g, "''")}'`;
}

function insertStatements(table: string, tableRows: Array<Record<string, unknown>>): string[] {
  if (tableRows.length === 0) return [];
  const columns = Object.keys(tableRows[0]!);

  return tableRows.map(
    (row) =>
      `INSERT INTO ${table} (${columns.join(', ')}) VALUES (${columns
        .map((column) => literal(row[column]))
        .join(', ')});`,
  );
}

export function registerExportTool(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'export',
    {
      title: 'Export everything',
      description:
        'Dump every client, project, task, and payment. format "json" returns structured ' +
        'data to read or transform; format "sql" returns INSERT statements that ' +
        'restore the data into an empty database. Use this for a backup or when ' +
        'the user asks for their data, not to answer questions about it — the ' +
        'list tools are cheaper for that.',
      inputSchema: {
        format: z.enum(['json', 'sql']).optional().describe('Default json'),
      },
    },
    async ({ format }) => {
      const dump = Object.fromEntries(
        await Promise.all(
          TABLES.map(async (table) => [
            table,
            await rows<Record<string, unknown>>(ctx.db, `SELECT * FROM ${table} ORDER BY id`),
          ]),
        ),
      ) as Record<(typeof TABLES)[number], Array<Record<string, unknown>>>;

      const counts = Object.fromEntries(
        TABLES.map((table) => [table, dump[table].length]),
      );

      if (format === 'sql') {
        const statements = TABLES.flatMap((table) => insertStatements(table, dump[table]));
        return ok(ctx, { format: 'sql', counts, sql: statements.join('\n') });
      }

      return ok(ctx, { format: 'json', counts, data: dump });
    },
  );
}
