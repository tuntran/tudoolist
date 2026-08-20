/**
 * The numbers that get asked for every month, computed in SQL.
 *
 * The alternative — listing rows and letting the agent add them up — burns
 * tokens proportional to the data and gets arithmetic wrong in ways that read
 * as confident. Anything not covered here is what `query` is for.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { one, rows } from '../db';
import { MONTH_PATTERN, sqlOffset, todayIn } from '../time';
import { ok, type ToolContext } from './shared';

/** Money is only ever grouped by paid_date, which is already a local date. */
const MONEY_SQL = `
  SELECT COALESCE(SUM(CASE WHEN substr(paid_date, 1, 7) = ?1 THEN amount END), 0) AS received_this_month,
         COALESCE(SUM(CASE WHEN substr(paid_date, 1, 4) = ?2 THEN amount END), 0) AS received_this_year,
         COALESCE(SUM(amount), 0)                                                 AS received_all_time,
         COUNT(CASE WHEN substr(paid_date, 1, 7) = ?1 THEN 1 END)                 AS payments_this_month
    FROM payment`;

/** Contract value not yet collected, ignoring work that was called off. */
const OUTSTANDING_SQL = `
  SELECT COALESCE(SUM(p.amount_total - COALESCE(paid.total, 0)), 0) AS outstanding
    FROM project p
    LEFT JOIN (SELECT project_id, SUM(amount) AS total FROM payment GROUP BY project_id) paid
           ON paid.project_id = p.id
   WHERE p.status <> 'cancelled'`;

/** created_at is UTC, so it needs the zone offset before it can be bucketed. */
const PROJECT_SQL = `
  SELECT COUNT(CASE WHEN strftime('%Y-%m', datetime(created_at, ?1)) = ?2 THEN 1 END) AS new_this_month,
         COUNT(CASE WHEN status = 'active' THEN 1 END)                                AS active,
         COUNT(CASE WHEN status = 'paused' THEN 1 END)                                AS paused,
         COUNT(CASE WHEN status = 'done' THEN 1 END)                                  AS done,
         COUNT(*)                                                                     AS total
    FROM project`;

const TASK_SQL = `
  SELECT COUNT(CASE WHEN strftime('%Y-%m', datetime(created_at, ?1)) = ?2 THEN 1 END) AS created_this_month,
         COUNT(CASE WHEN done_at IS NOT NULL
                     AND strftime('%Y-%m', datetime(done_at, ?1)) = ?2 THEN 1 END)    AS finished_this_month,
         COUNT(CASE WHEN status <> 'done' THEN 1 END)                                 AS open,
         COUNT(CASE WHEN status = 'doing' THEN 1 END)                                 AS in_progress,
         COUNT(CASE WHEN status <> 'done' AND due_date < ?3 THEN 1 END)               AS overdue
    FROM task`;

/**
 * Per-client figures come from correlated subqueries rather than a join,
 * because joining projects and payments together multiplies contract values by
 * the number of payments against them.
 */
const BY_CLIENT_SQL = `
  SELECT c.id AS client_id, c.name AS client_name, c.phone,
         (SELECT COALESCE(SUM(pm.amount), 0)
            FROM payment pm JOIN project p ON p.id = pm.project_id
           WHERE p.client_id = c.id AND substr(pm.paid_date, 1, 7) = ?1) AS received_this_month,
         (SELECT COALESCE(SUM(p.amount_total), 0)
            FROM project p WHERE p.client_id = c.id AND p.status <> 'cancelled')
         - (SELECT COALESCE(SUM(pm.amount), 0)
              FROM payment pm JOIN project p ON p.id = pm.project_id
             WHERE p.client_id = c.id AND p.status <> 'cancelled')       AS outstanding
    FROM client c
   ORDER BY received_this_month DESC, outstanding DESC`;

/** Enough history to see a trend without asking for a date range. */
const RECENT_MONTHS_SQL = `
  SELECT substr(paid_date, 1, 7) AS month,
         SUM(amount)             AS received,
         COUNT(*)                AS payments
    FROM payment
   GROUP BY month
   ORDER BY month DESC
   LIMIT 6`;

export function registerOverviewTool(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'overview',
    {
      title: 'Overview and monthly figures',
      description:
        'The whole picture in one call: money received this month and this year, ' +
        'what is still owed, new and active projects, tasks created and finished, ' +
        'a per-client breakdown, and the last 6 months of income. ' +
        'Pass month as YYYY-MM to report on an earlier month; it defaults to the ' +
        'current month in the local zone. Amounts are whole VND. ' +
        'Use this instead of listing rows and adding them up.',
      inputSchema: {
        month: z
          .string()
          .regex(MONTH_PATTERN)
          .optional()
          .describe('e.g. 2026-07. Defaults to the current local month'),
      },
    },
    async ({ month }) => {
      const today = todayIn(ctx.tz);
      const period = month ?? today.slice(0, 7);
      const year = period.slice(0, 4);
      const offset = sqlOffset(ctx.tz);

      type Row = Record<string, unknown>;
      const [money, outstanding, projects, tasks, by_client, recent_months] = await Promise.all([
        one<Row>(ctx.db, MONEY_SQL, [period, year]),
        one<Row>(ctx.db, OUTSTANDING_SQL),
        one<Row>(ctx.db, PROJECT_SQL, [offset, period]),
        one<Row>(ctx.db, TASK_SQL, [offset, period, today]),
        rows(ctx.db, BY_CLIENT_SQL, [period]),
        rows(ctx.db, RECENT_MONTHS_SQL),
      ]);

      return ok(ctx, {
        month: period,
        money: { ...money, ...outstanding },
        projects,
        tasks,
        by_client,
        recent_months,
        currency: 'VND',
      });
    },
  );
}
