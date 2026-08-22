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
 * Repos are a list of URLs on the project, not rows of their own. The only
 * question ever asked is where the code lives, so an id, a label and a
 * timestamp per link were structure nobody queried.
 */
const REPOS = z
  .array(z.string().min(1).describe('e.g. https://github.com/tuntran/tudoolist'))
  .describe(
    'The complete repo URL list for this project — it replaces whatever is stored. ' +
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
         c.telegram AS client_telegram, c.zalo AS client_zalo,
         c.facebook AS client_facebook,
         p.amount_total,
         COALESCE(paid.total, 0)                  AS amount_paid,
         p.amount_total - COALESCE(paid.total, 0) AS outstanding,
         p.description, p.note, p.repos, p.created_at,
         (SELECT COUNT(*) FROM task t WHERE t.project_id = p.id AND t.status <> 'done') AS open_tasks
    FROM project p
    JOIN client c ON c.id = p.client_id
    LEFT JOIN (SELECT project_id, SUM(amount) AS total FROM payment GROUP BY project_id) paid
           ON paid.project_id = p.id`;

/**
 * The repos column holds a JSON array. Everything above the database works
 * with a real array, so the encode/decode pair lives here and nowhere else.
 *
 * A row written before this column existed reads back as null, and a value
 * that somehow is not an array is treated as absent rather than thrown at the
 * caller — a malformed link list should not make a project unreadable.
 */
function decodeRepos(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.length === 0) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((url): url is string => typeof url === 'string') : [];
  } catch {
    return [];
  }
}

/** Reject a list that repeats a URL; storing it twice is a mistake every time. */
function duplicateIn(repos: string[]): string | null {
  const seen = new Set<string>();
  for (const url of repos) {
    if (seen.has(url)) return `the same repo appears twice in the list: ${url}`;
    seen.add(url);
  }
  return null;
}

/** Swap the stored JSON string for the array a caller expects to read. */
function withRepos<T extends { repos?: unknown }>(project: T): Omit<T, 'repos'> & { repos: string[] } {
  return { ...project, repos: decodeRepos(project.repos) };
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

      const projects = await rows<{ repos?: unknown }>(
        ctx.db,
        `${PROJECT_SELECT} ${where.sql} ORDER BY p.id`,
        where.params,
      );
      return ok(ctx, { projects: projects.map(withRepos) });
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

      const duplicate = repos && duplicateIn(repos);
      if (duplicate) return fail(ctx, duplicate);

      const result = await exec(
        ctx.db,
        `INSERT INTO project (client_id, name, amount_total, description, note, repos)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [
          client_id,
          name,
          amount_total ?? 0,
          description ?? null,
          note ?? null,
          repos ? JSON.stringify(repos) : null,
        ],
      );

      const created = await one<{ repos?: unknown }>(ctx.db, `${PROJECT_SELECT} WHERE p.id = ?`, [
        result.meta.last_row_id,
      ]);
      return ok(ctx, { project: created && withRepos(created) });
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
      const duplicate = repos && duplicateIn(repos);
      if (duplicate) return fail(ctx, duplicate);

      // repos is a column like any other once it has been encoded.
      const update = setClause({ ...fields, repos: repos && JSON.stringify(repos) });
      if (!update) return fail(ctx, 'nothing to update — pass at least one field besides id');

      const result = await exec(ctx.db, `UPDATE project SET ${update.sql} WHERE id = ?`, [
        ...update.params,
        id,
      ]);
      if (result.meta.changes === 0) return fail(ctx, `no project with id ${id}`);

      const updated = await one<{ repos?: unknown }>(ctx.db, `${PROJECT_SELECT} WHERE p.id = ?`, [
        id,
      ]);
      return ok(ctx, { project: updated && withRepos(updated) });
    },
  );
}
