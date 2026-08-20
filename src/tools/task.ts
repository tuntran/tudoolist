/**
 * Task tools. A task is a flat one-liner — no subtasks, no tags — because most
 * of them are a feature note with nothing more to say.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec, one, rows, setClause, whereClause, type Condition } from '../db';
import { DATE_PATTERN, utcNow } from '../time';
import { fail, ok, type ToolContext } from './shared';

const STATUSES = ['todo', 'doing', 'done'] as const;

const DUE_DATE = z
  .string()
  .regex(DATE_PATTERN)
  .describe('Local calendar date YYYY-MM-DD, e.g. 2026-08-27 — never a timestamp');

/** Selecting the task plus the context an agent needs to talk about it. */
const TASK_SELECT = `
  SELECT t.id, t.title, t.status, t.due_date, t.note,
         t.project_id, p.name AS project_name, c.name AS client_name
    FROM task t
    LEFT JOIN project p ON p.id = t.project_id
    LEFT JOIN client c ON c.id = p.client_id`;

export function registerTaskTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'task_list',
    {
      title: 'List tasks',
      description:
        'List tasks, open ones first. Filters combine. Done tasks are hidden ' +
        'unless include_done is true, because the usual question is what is left. ' +
        'A task with no project is personal work not tied to any client.',
      inputSchema: {
        project_id: z.number().int().optional(),
        client_id: z.number().int().optional().describe('Every task across this client\'s projects'),
        status: z.enum(STATUSES).optional(),
        due_before: DUE_DATE.optional().describe('Only tasks due on or before this date'),
        include_done: z.boolean().optional().describe('Default false'),
        limit: z.number().int().min(1).max(200).optional().describe('Default 50'),
      },
    },
    async ({ project_id, client_id, status, due_before, include_done, limit }) => {
      const conditions: Condition[] = [
        ['t.project_id = ?', project_id],
        ['p.client_id = ?', client_id],
        ['t.status = ?', status],
        ['t.due_date <= ?', due_before],
      ];
      if (!include_done && !status) conditions.push(["t.status <> 'done'"]);

      const where = whereClause(conditions);
      const tasks = await rows(
        ctx.db,
        `${TASK_SELECT} ${where.sql}
          ORDER BY t.status = 'done', t.due_date IS NULL, t.due_date, t.id
          LIMIT ?`,
        [...where.params, limit ?? 50],
      );
      return ok(ctx, { tasks });
    },
  );

  server.registerTool(
    'task_add',
    {
      title: 'Add a task',
      description:
        'Add a task. The title alone is usually enough — most tasks are a short ' +
        'feature note, so leave note empty rather than inventing detail. ' +
        'Omit project_id for personal work that belongs to no client.',
      inputSchema: {
        title: z.string().min(1).describe('One line, e.g. "Đặt bàn online"'),
        project_id: z.number().int().optional().describe('Owning project, from project_list'),
        due_date: DUE_DATE.optional(),
        note: z.string().optional().describe('Only when there is something genuinely unresolved'),
        status: z.enum(STATUSES).optional().describe('Default todo'),
      },
    },
    async ({ title, project_id, due_date, note, status }) => {
      if (project_id !== undefined) {
        const project = await one(ctx.db, 'SELECT id FROM project WHERE id = ?', [project_id]);
        if (!project) return fail(ctx, `no project with id ${project_id}`);
      }

      const result = await exec(
        ctx.db,
        'INSERT INTO task (title, project_id, due_date, note, status) VALUES (?, ?, ?, ?, ?)',
        [title, project_id ?? null, due_date ?? null, note ?? null, status ?? 'todo'],
      );
      return ok(ctx, {
        task: await one(ctx.db, `${TASK_SELECT} WHERE t.id = ?`, [result.meta.last_row_id]),
      });
    },
  );

  server.registerTool(
    'task_update',
    {
      title: 'Update a task',
      description:
        'Change a task: retitle it, move it between projects, set or clear a due ' +
        'date, or change status. Pass null for due_date, note, or project_id to ' +
        'clear that field. To simply finish a task, use task_done instead.',
      inputSchema: {
        id: z.number().int().describe('Task to change, from task_list'),
        title: z.string().min(1).optional(),
        status: z.enum(STATUSES).optional(),
        due_date: DUE_DATE.nullable().optional().describe('null clears the due date'),
        note: z.string().nullable().optional(),
        project_id: z.number().int().nullable().optional().describe('null detaches from any project'),
      },
    },
    async ({ id, ...fields }) => {
      if (fields.project_id != null) {
        const project = await one(ctx.db, 'SELECT id FROM project WHERE id = ?', [
          fields.project_id,
        ]);
        if (!project) return fail(ctx, `no project with id ${fields.project_id}`);
      }

      // done_at must follow status, or a reopened task keeps a completion time.
      const done_at =
        fields.status === undefined ? undefined : fields.status === 'done' ? utcNow() : null;

      const update = setClause({ ...fields, done_at });
      if (!update) return fail(ctx, 'nothing to update — pass at least one field besides id');

      const result = await exec(ctx.db, `UPDATE task SET ${update.sql} WHERE id = ?`, [
        ...update.params,
        id,
      ]);
      if (result.meta.changes === 0) return fail(ctx, `no task with id ${id}`);

      return ok(ctx, { task: await one(ctx.db, `${TASK_SELECT} WHERE t.id = ?`, [id]) });
    },
  );

  server.registerTool(
    'task_done',
    {
      title: 'Finish a task',
      description:
        'Mark a task finished. This is the most common thing to do to a task, ' +
        'which is why it is its own tool. Safe to call twice: a task that is ' +
        'already done keeps its original completion time.',
      inputSchema: {
        id: z.number().int().describe('Task to finish, from task_list'),
      },
    },
    async ({ id }) => {
      const task = await one<{ status: string }>(ctx.db, 'SELECT status FROM task WHERE id = ?', [
        id,
      ]);
      if (!task) return fail(ctx, `no task with id ${id}`);

      if (task.status !== 'done') {
        await exec(ctx.db, "UPDATE task SET status = 'done', done_at = ? WHERE id = ?", [
          utcNow(),
          id,
        ]);
      }
      return ok(ctx, { task: await one(ctx.db, `${TASK_SELECT} WHERE t.id = ?`, [id]) });
    },
  );
}
