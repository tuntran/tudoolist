/**
 * Project tools. Money lives here, not on the client: a person can hand over
 * several jobs, each with its own agreed price and its own advance payment.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec, one, rows, setClause, whereClause } from '../db';
import { fail, ok, type ToolContext } from './shared';

const STATUSES = ['active', 'paused', 'done', 'cancelled'] as const;

const MONEY = z.number().int().min(0).describe('Whole VND, e.g. 35000000 for 35 triệu');

/**
 * description and note pull apart what used to share one field. Scope barely
 * changes; status changes weekly. Writing one into the other loses it.
 */
const DESCRIPTION = z
  .string()
  .describe('What the project actually is — the scope. Stays roughly fixed once written');

const NOTE_HINT = 'Where it stands right now, e.g. "còn phần gửi mail". Changes often';

/**
 * Repos are a field on the project rather than their own pair of add/remove
 * tools: the surface stays small, and the caller states the list it wants
 * instead of computing a diff against what is stored.
 */
const REPOS = z
  .array(
    z.object({
      url: z.string().min(1).describe('e.g. https://github.com/tuntran/tudoolist'),
      label: z
        .string()
        .optional()
        .describe('Which part it is: "frontend", "api", "mobile". Skip for a single repo'),
    }),
  )
  .describe(
    'The complete repo list for this project — it replaces whatever is stored. ' +
      'To add one, send the existing repos from project_list plus the new one; ' +
      'to remove one, send the list without it; send [] to clear.',
  );

/**
 * A project always reports what it has been paid, which is the sum of its
 * payments — there is no stored total to read.
 */
const PROJECT_SELECT = `
  SELECT p.id, p.name, p.status, p.client_id,
         c.name AS client_name, c.phone AS client_phone,
         p.amount_total,
         COALESCE(paid.total, 0)                  AS amount_paid,
         p.amount_total - COALESCE(paid.total, 0) AS outstanding,
         p.description, p.note, p.created_at,
         (SELECT COUNT(*) FROM task t WHERE t.project_id = p.id AND t.status <> 'done') AS open_tasks
    FROM project p
    JOIN client c ON c.id = p.client_id
    LEFT JOIN (SELECT project_id, SUM(amount) AS total FROM payment GROUP BY project_id) paid
           ON paid.project_id = p.id`;

type RepoInput = { url: string; label?: string };

/**
 * Replace a project's repo list wholesale.
 *
 * Delete-then-insert rather than a diff: the list is a handful of rows, and
 * working out which ones changed costs more code than rewriting them.
 * Returns an error message when the caller sent the same URL twice, which the
 * table's UNIQUE would otherwise reject with something far less legible.
 */
async function replaceRepos(
  ctx: ToolContext,
  projectId: number,
  repos: RepoInput[],
): Promise<string | null> {
  const seen = new Set<string>();
  for (const { url } of repos) {
    if (seen.has(url)) return `the same repo appears twice in the list: ${url}`;
    seen.add(url);
  }

  await exec(ctx.db, 'DELETE FROM repo WHERE project_id = ?', [projectId]);
  for (const { url, label } of repos) {
    await exec(ctx.db, 'INSERT INTO repo (project_id, url, label) VALUES (?, ?, ?)', [
      projectId,
      url,
      label ?? null,
    ]);
  }
  return null;
}

/**
 * Repos are fetched separately and grouped in code rather than aggregated in
 * SQL, which would return them as a JSON string the caller has to parse back.
 */
async function withRepos<T extends { id: number }>(
  ctx: ToolContext,
  projects: T[],
): Promise<Array<T & { repos: unknown[] }>> {
  if (projects.length === 0) return [];

  const placeholders = projects.map(() => '?').join(', ');
  const links = await rows<{ project_id: number; id: number; url: string; label: string | null }>(
    ctx.db,
    `SELECT id, project_id, url, label FROM repo WHERE project_id IN (${placeholders}) ORDER BY id`,
    projects.map((p) => p.id),
  );

  return projects.map((project) => ({
    ...project,
    repos: links
      .filter((link) => link.project_id === project.id)
      .map(({ id, url, label }) => ({ id, url, label })),
  }));
}

export function registerProjectTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'project_list',
    {
      title: 'List projects',
      description:
        'List projects with their client, agreed price, amount already paid, ' +
        'what is still owed, and any linked repos. Amounts are whole VND. ' +
        'Filter by client or status; with no filter it returns everything, ' +
        'newest project last.',
      inputSchema: {
        client_id: z.number().int().optional().describe('Only this client\'s projects'),
        status: z.enum(STATUSES).optional().describe('Only projects in this status'),
      },
    },
    async ({ client_id, status }) => {
      const where = whereClause([
        ['p.client_id = ?', client_id],
        ['p.status = ?', status],
      ]);

      const projects = await rows<{ id: number }>(
        ctx.db,
        `${PROJECT_SELECT} ${where.sql} ORDER BY p.id`,
        where.params,
      );
      return ok(ctx, { projects: await withRepos(ctx, projects) });
    },
  );

  server.registerTool(
    'project_add',
    {
      title: 'Add a project',
      description:
        'Create a project for an existing client. Call client_list first if the ' +
        'client id is unknown, or client_add if the person is new. ' +
        'Leave amount_total out when nothing has been agreed yet. Money already ' +
        'received is recorded separately with payment_add, so that the date it ' +
        'arrived is kept.',
      inputSchema: {
        client_id: z.number().int().describe('Owning client, from client_list'),
        name: z.string().min(1).describe('What the job is called'),
        amount_total: MONEY.optional().describe('Agreed contract value in VND'),
        description: DESCRIPTION.optional(),
        note: z.string().optional().describe(NOTE_HINT),
        repos: REPOS.optional(),
      },
    },
    async ({ client_id, name, amount_total, description, note, repos }) => {
      const client = await one(ctx.db, 'SELECT id FROM client WHERE id = ?', [client_id]);
      if (!client) return fail(ctx, `no client with id ${client_id}`);

      const result = await exec(
        ctx.db,
        `INSERT INTO project (client_id, name, amount_total, description, note)
         VALUES (?, ?, ?, ?, ?)`,
        [client_id, name, amount_total ?? 0, description ?? null, note ?? null],
      );
      const id = result.meta.last_row_id;

      if (repos) {
        const rejected = await replaceRepos(ctx, id, repos);
        if (rejected) return fail(ctx, rejected);
      }

      const created = await one<{ id: number }>(ctx.db, `${PROJECT_SELECT} WHERE p.id = ?`, [id]);
      return ok(ctx, { project: (await withRepos(ctx, created ? [created] : []))[0] });
    },
  );

  server.registerTool(
    'project_update',
    {
      title: 'Update a project',
      description:
        'Rename a project, move its status, change the agreed price, edit its ' +
        'description or note, or set its repo list. Money received is not set ' +
        'here — use payment_add, which keeps the date each payment arrived.',
      inputSchema: {
        id: z.number().int().describe('Project to change, from project_list'),
        name: z.string().min(1).optional(),
        status: z.enum(STATUSES).optional(),
        amount_total: MONEY.optional().describe('New agreed value in VND'),
        description: DESCRIPTION.nullable().optional(),
        note: z.string().nullable().optional().describe(NOTE_HINT),
        repos: REPOS.optional(),
      },
    },
    async ({ id, repos, ...fields }) => {
      const exists = await one(ctx.db, 'SELECT id FROM project WHERE id = ?', [id]);
      if (!exists) return fail(ctx, `no project with id ${id}`);

      const update = setClause(fields);
      if (!update && !repos) {
        return fail(ctx, 'nothing to update — pass at least one field besides id');
      }

      if (update) {
        await exec(ctx.db, `UPDATE project SET ${update.sql} WHERE id = ?`, [...update.params, id]);
      }
      if (repos) {
        const rejected = await replaceRepos(ctx, id, repos);
        if (rejected) return fail(ctx, rejected);
      }

      const updated = await one<{ id: number }>(ctx.db, `${PROJECT_SELECT} WHERE p.id = ?`, [id]);
      return ok(ctx, { project: (await withRepos(ctx, updated ? [updated] : []))[0] });
    },
  );
}
