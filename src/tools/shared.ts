/** Plumbing every tool module needs: what it can reach, and how it answers. */

import { localTime, todayIn, utcNow } from '../time';

export interface ToolContext {
  db: D1Database;
  /** IANA zone every date and displayed time is resolved in. */
  tz: string;
}

type ToolResult = {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
};

/**
 * Every reply carries when and where it was produced.
 *
 * An agent reading a bare "2026-08-20" has no way to know whether that date was
 * derived in UTC or in the user's zone, and the two disagree for seven hours of
 * every day. Stamping each result removes the guess: `today` is the day the
 * server means when it says today, and `tz` says whose day that is.
 */
function asOf(ctx: ToolContext) {
  return {
    now: localTime(utcNow(), ctx.tz),
    today: todayIn(ctx.tz),
    tz: ctx.tz,
    now_utc: utcNow(),
  };
}

/**
 * Tools answer with JSON in a text block. An agent reads the result, so the
 * payload stays machine-shaped rather than prose.
 */
export function ok(ctx: ToolContext, payload: Record<string, unknown>): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ ...payload, as_of: asOf(ctx) }) }],
  };
}

/**
 * A failure the caller can act on — a missing row, an empty update. Flagged
 * with isError so the agent sees it failed instead of reading it as data.
 */
export function fail(ctx: ToolContext, message: string): ToolResult {
  return {
    content: [{ type: 'text', text: JSON.stringify({ error: message, as_of: asOf(ctx) }) }],
    isError: true,
  };
}
