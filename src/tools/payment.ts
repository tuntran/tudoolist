/**
 * Recording money as it arrives.
 *
 * The amount a project has been paid is the sum of these rows, never a stored
 * total — that is what makes "how much came in last month" answerable at all.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec, one, rows } from '../db';
import { DATE_PATTERN, MONTH_PATTERN, todayIn } from '../time';
import { fail, ok, type ToolContext } from './shared';

export function registerPaymentTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'payment_add',
    {
      title: 'Record a payment',
      description:
        'Record money received on a project. Send the amount that just arrived, ' +
        'not the new total — two payments of 8 triệu and 5 triệu are two calls, ' +
        'and the project then shows 13 triệu paid. paid_date defaults to today ' +
        'in the local zone; pass it when the money arrived on an earlier day. ' +
        'To correct a mistake, add a negative amount rather than editing history.',
      inputSchema: {
        project_id: z.number().int().describe('Project the money is for, from project_list'),
        amount: z
          .number()
          .int()
          .describe('Whole VND that arrived, e.g. 5000000. Negative to reverse an earlier entry'),
        paid_date: z
          .string()
          .regex(DATE_PATTERN)
          .optional()
          .describe('Local date YYYY-MM-DD the money arrived. Defaults to today'),
        note: z.string().optional().describe('e.g. "Ứng đợt 2"'),
      },
    },
    async ({ project_id, amount, paid_date, note }) => {
      const project = await one<{ name: string; amount_total: number }>(
        ctx.db,
        'SELECT name, amount_total FROM project WHERE id = ?',
        [project_id],
      );
      if (!project) return fail(ctx, `no project with id ${project_id}`);
      if (amount === 0) return fail(ctx, 'amount must not be zero');

      await exec(
        ctx.db,
        'INSERT INTO payment (project_id, amount, paid_date, note) VALUES (?, ?, ?, ?)',
        [project_id, amount, paid_date ?? todayIn(ctx.tz), note ?? null],
      );

      const totals = await one<{ paid: number }>(
        ctx.db,
        'SELECT COALESCE(SUM(amount), 0) AS paid FROM payment WHERE project_id = ?',
        [project_id],
      );
      const paid = totals?.paid ?? 0;

      return ok(ctx, {
        recorded: amount,
        project: {
          id: project_id,
          name: project.name,
          amount_total: project.amount_total,
          amount_paid: paid,
          outstanding: project.amount_total - paid,
        },
      });
    },
  );

  server.registerTool(
    'payment_list',
    {
      title: 'List payments',
      description:
        'Payment history, newest first. Filter by project, client, or a month ' +
        'like "2026-08". Use this to see when money actually arrived; for a ' +
        'single monthly total, overview is one call instead of adding these up.',
      inputSchema: {
        project_id: z.number().int().optional(),
        client_id: z.number().int().optional(),
        month: z.string().regex(MONTH_PATTERN).optional().describe('e.g. 2026-08'),
        limit: z.number().int().min(1).max(200).optional().describe('Default 50'),
      },
    },
    async ({ project_id, client_id, month, limit }) => {
      const payments = await rows<{ amount: number }>(
        ctx.db,
        `SELECT pm.id, pm.amount, pm.paid_date, pm.note,
                pm.project_id, p.name AS project_name, c.name AS client_name
           FROM payment pm
           JOIN project p ON p.id = pm.project_id
           JOIN client c ON c.id = p.client_id
          WHERE (? IS NULL OR pm.project_id = ?)
            AND (? IS NULL OR p.client_id = ?)
            AND (? IS NULL OR substr(pm.paid_date, 1, 7) = ?)
          ORDER BY pm.paid_date DESC, pm.id DESC
          LIMIT ?`,
        [
          project_id ?? null,
          project_id ?? null,
          client_id ?? null,
          client_id ?? null,
          month ?? null,
          month ?? null,
          limit ?? 50,
        ],
      );

      const total = payments.reduce((sum, p) => sum + p.amount, 0);
      return ok(ctx, { payments, total_shown: total, currency: 'VND' });
    },
  );
}
