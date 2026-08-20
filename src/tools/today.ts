/**
 * The one-call overview.
 *
 * Without it an agent asked "what's on today" has to run four list calls and
 * assemble them, which is slower and easy to get subtly wrong — especially the
 * boundary between overdue and due today, which depends on the local date.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { rows } from '../db';
import { shiftDays, todayIn } from '../time';
import { ok, type ToolContext } from './shared';

const OPEN_TASK = `
  SELECT t.id, t.title, t.status, t.due_date, t.note,
         t.project_id, p.name AS project_name, c.name AS client_name
    FROM task t
    LEFT JOIN project p ON p.id = t.project_id
    LEFT JOIN client c ON c.id = p.client_id
   WHERE t.status <> 'done'`;

export function registerTodayTool(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'today',
    {
      title: "Today's overview",
      description:
        'Everything that matters right now in one call: overdue tasks, tasks due ' +
        'today, what is already in progress, what falls due in the next 7 days, ' +
        'and money still owed per client. Dates are resolved in the local zone ' +
        'reported in as_of, so "today" means the user\'s day, not UTC. ' +
        'Prefer this over several task_list calls when asked what to work on.',
      inputSchema: {},
    },
    async () => {
      const today = todayIn(ctx.tz);
      const horizon = shiftDays(today, 7);

      const [overdue, due_today, in_progress, due_soon, owed] = await Promise.all([
        rows(ctx.db, `${OPEN_TASK} AND t.due_date < ? ORDER BY t.due_date`, [today]),
        rows(ctx.db, `${OPEN_TASK} AND t.due_date = ? ORDER BY t.id`, [today]),
        rows(ctx.db, `${OPEN_TASK} AND t.status = 'doing' ORDER BY t.id`),
        rows(ctx.db, `${OPEN_TASK} AND t.due_date > ? AND t.due_date <= ? ORDER BY t.due_date`, [
          today,
          horizon,
        ]),
        rows(
          ctx.db,
          `SELECT c.id AS client_id, c.name AS client_name, c.phone,
                  SUM(p.amount_total - COALESCE(paid.total, 0)) AS outstanding
             FROM project p
             JOIN client c ON c.id = p.client_id
             LEFT JOIN (SELECT project_id, SUM(amount) AS total FROM payment GROUP BY project_id) paid
                    ON paid.project_id = p.id
            WHERE p.status <> 'cancelled'
            GROUP BY c.id
           HAVING outstanding > 0
            ORDER BY outstanding DESC`,
        ),
      ]);

      return ok(ctx, {
        overdue,
        due_today,
        in_progress,
        due_soon,
        due_soon_through: horizon,
        owed_by_client: owed,
        // Amounts throughout are whole VND, restated here so a caller reading
        // only the summary does not have to infer the unit.
        currency: 'VND',
      });
    },
  );
}
