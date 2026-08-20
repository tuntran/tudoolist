/**
 * Repository links on a project.
 *
 * A project routinely spans several repos, so these are rows rather than a
 * field. They show up inside project_list, which is why there is no repo_list.
 */

import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { exec, one, rows } from '../db';
import { fail, ok, type ToolContext } from './shared';

export function registerRepoTools(server: McpServer, ctx: ToolContext): void {
  server.registerTool(
    'repo_add',
    {
      title: 'Link a repository',
      description:
        'Attach a repository URL to a project. A project can have several — ' +
        'give each a label like "frontend" or "api" when there is more than one. ' +
        'Linking the same URL to the same project twice is rejected. ' +
        'Existing repos are already listed by project_list.',
      inputSchema: {
        project_id: z.number().int().describe('Project to link to, from project_list'),
        url: z.string().min(1).describe('e.g. https://github.com/tuntran/tudoolist'),
        label: z
          .string()
          .optional()
          .describe('Which part this is: "frontend", "api", "mobile". Skip for a single repo'),
      },
    },
    async ({ project_id, url, label }) => {
      const project = await one(ctx.db, 'SELECT id FROM project WHERE id = ?', [project_id]);
      if (!project) return fail(ctx, `no project with id ${project_id}`);

      const duplicate = await one(
        ctx.db,
        'SELECT id FROM repo WHERE project_id = ? AND url = ?',
        [project_id, url],
      );
      if (duplicate) return fail(ctx, `that repo is already linked to project ${project_id}`);

      await exec(ctx.db, 'INSERT INTO repo (project_id, url, label) VALUES (?, ?, ?)', [
        project_id,
        url,
        label ?? null,
      ]);

      return ok(ctx, {
        project_id,
        repos: await rows(
          ctx.db,
          'SELECT id, url, label FROM repo WHERE project_id = ? ORDER BY id',
          [project_id],
        ),
      });
    },
  );

  server.registerTool(
    'repo_remove',
    {
      title: 'Unlink a repository',
      description:
        'Remove a repo link, for when a URL was mistyped or a repo moved. ' +
        'Takes the repo id shown by project_list, not the project id.',
      inputSchema: {
        id: z.number().int().describe('Repo id, from the repos list inside project_list'),
      },
    },
    async ({ id }) => {
      const repo = await one<{ project_id: number; url: string }>(
        ctx.db,
        'SELECT project_id, url FROM repo WHERE id = ?',
        [id],
      );
      if (!repo) return fail(ctx, `no repo with id ${id}`);

      await exec(ctx.db, 'DELETE FROM repo WHERE id = ?', [id]);
      return ok(ctx, {
        removed: { id, url: repo.url },
        project_id: repo.project_id,
        repos: await rows(
          ctx.db,
          'SELECT id, url, label FROM repo WHERE project_id = ? ORDER BY id',
          [repo.project_id],
        ),
      });
    },
  );
}
