/**
 * Read-only SQL, for the questions nobody thought to build a tool for.
 *
 * The guard is deliberately crude and layered rather than clever: a statement
 * must start with SELECT or WITH, may not contain a statement separator, and
 * D1's prepare() executes exactly one statement anyway. SQLite has no
 * data-modifying CTEs, so `WITH` cannot smuggle a write in either.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { rows } from '../db';
import { fail, ok, type ToolContext } from './shared';

/** Beyond this the answer belongs in a narrower query, not a bigger dump. */
const MAX_ROWS = 200;

const READ_ONLY_START = /^\s*(select|with)\b/i;

/** Comments could hide a separator from the check below, so they go first. */
function stripComments(sql: string): string {
  return sql.replace(/--[^\n]*/g, ' ').replace(/\/\*[\s\S]*?\*\//g, ' ');
}

function rejectionReason(sql: string): string | null {
  const bare = stripComments(sql).trim().replace(/;\s*$/, '');

  if (bare.length === 0) return 'empty query';
  if (!READ_ONLY_START.test(bare)) return 'only SELECT and WITH queries are allowed';
  if (bare.includes(';')) return 'only one statement per call — remove the ";"';

  return null;
}

export function registerQueryTool(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'query',
    {
      title: 'Read-only SQL',
      description:
        'Run one SELECT against the database for a question the other tools do ' +
        'not cover. Writes are rejected. ' +
        'Tables: client(id, name, phone, telegram, zalo, facebook, note, created_at) ' +
        'where every contact channel is nullable and only some are ever filled in; ' +
        'project(id, client_id, name, status, amount_total, description, note, repos, created_at) ' +
        'with status in active/paused/done/cancelled; ' +
        'task(id, project_id, title, status, due_date, note, created_at, done_at) ' +
        'with status in todo/doing/done; ' +
        'payment(id, project_id, amount, paid_date, note, created_at). ' +
        'project.repos is a JSON array of repo URLs, so use json_each(project.repos) to unnest it. ' +
        'Amounts are whole VND. A project\'s paid total is SUM(payment.amount) — ' +
        'there is no amount_paid column. due_date and paid_date are local ' +
        'YYYY-MM-DD strings and compare as text; created_at and done_at are UTC ' +
        'timestamps, so shift them by as_of.tz before grouping by month. ' +
        'Prefer overview or today when they already answer the question.',
      inputSchema: {
        sql: z.string().min(1).describe('A single SELECT statement, no trailing semicolon needed'),
        params: z
          .array(z.union([z.string(), z.number(), z.null()]))
          .optional()
          .describe('Values for ? placeholders. Use these instead of pasting values into the SQL'),
      },
    },
    async ({ sql, params }) => {
      const rejected = rejectionReason(sql);
      if (rejected) return fail(ctx, rejected);

      let result: Array<Record<string, unknown>>;
      try {
        result = await rows<Record<string, unknown>>(ctx.db, sql, params ?? []);
      } catch (error) {
        // SQLite's message names the actual problem — pass it through so the
        // agent can fix its own SQL instead of guessing.
        return fail(ctx, `query failed: ${(error as Error).message}`);
      }

      const truncated = result.length > MAX_ROWS;
      return ok(ctx, {
        sql,
        columns: Object.keys(result[0] ?? {}),
        row_count: result.length,
        truncated,
        rows: truncated ? result.slice(0, MAX_ROWS) : result,
      });
    },
  );
}
