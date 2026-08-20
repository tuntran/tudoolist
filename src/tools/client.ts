/** Client tools. Clients are individuals, so a phone number is the real handle. */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec, one, rows } from '../db';
import { ok, type ToolContext } from './shared';

interface ClientRow {
  id: number;
  name: string;
  phone: string | null;
  note: string | null;
  projects: number;
  outstanding: number;
}

export function registerClientTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'client_list',
    {
      title: 'List clients',
      description:
        'List every client with how many projects they have and how much money ' +
        'they still owe across all of them. Amounts are whole VND. ' +
        'Use this to answer "who are my clients" or "who still owes me".',
      inputSchema: {},
    },
    async () => {
      // Projects and payments are counted in subqueries rather than joined
      // together: joining both would multiply each contract value by the number
      // of payments made against it.
      const clients = await rows<ClientRow>(
        ctx.db,
        `SELECT c.id, c.name, c.phone, c.note,
                (SELECT COUNT(*) FROM project p WHERE p.client_id = c.id) AS projects,
                (SELECT COALESCE(SUM(p.amount_total), 0)
                   FROM project p WHERE p.client_id = c.id AND p.status <> 'cancelled')
                - (SELECT COALESCE(SUM(pm.amount), 0)
                     FROM payment pm JOIN project p ON p.id = pm.project_id
                    WHERE p.client_id = c.id AND p.status <> 'cancelled') AS outstanding
           FROM client c
          ORDER BY c.name`,
      );
      return ok(ctx, { clients });
    },
  );

  server.registerTool(
    'client_add',
    {
      title: 'Add a client',
      description:
        'Create a client. Only the name is required; add the phone number when ' +
        'it is known, since that is how these clients are actually contacted. ' +
        'Returns the new client id, which project_add needs.',
      inputSchema: {
        name: z.string().min(1).describe('Full name of the person'),
        phone: z.string().optional().describe('Phone number, e.g. 0912345678'),
        note: z.string().optional().describe('How you know them, or anything worth remembering'),
      },
    },
    async ({ name, phone, note }) => {
      const result = await exec(
        ctx.db,
        'INSERT INTO client (name, phone, note) VALUES (?, ?, ?)',
        [name, phone ?? null, note ?? null],
      );
      const id = result.meta.last_row_id;
      return ok(ctx, { client: await one(ctx.db, 'SELECT * FROM client WHERE id = ?', [id]) });
    },
  );
}
