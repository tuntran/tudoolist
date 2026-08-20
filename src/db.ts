/** Small helpers over D1. No ORM: five tables do not need one. */

export async function rows<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<T[]> {
  const result = await db
    .prepare(sql)
    .bind(...params)
    .all<T>();
  return result.results ?? [];
}

export async function one<T>(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<T | null> {
  return (
    (await db
      .prepare(sql)
      .bind(...params)
      .first<T>()) ?? null
  );
}

export async function exec(
  db: D1Database,
  sql: string,
  params: unknown[] = [],
): Promise<D1Result> {
  return db
    .prepare(sql)
    .bind(...params)
    .run();
}

/**
 * Turn the fields a caller actually supplied into a SET clause.
 *
 * Every update tool takes all-optional fields, and an agent typically sends one
 * of them. Without this, each tool would need its own combinatorial SQL.
 * Returns null when there is nothing to update, which the caller reports rather
 * than issuing `SET` with no assignments.
 */
export function setClause(fields: Record<string, unknown>): {
  sql: string;
  params: unknown[];
} | null {
  const present = Object.entries(fields).filter(([, value]) => value !== undefined);
  if (present.length === 0) return null;

  return {
    sql: present.map(([column]) => `${column} = ?`).join(', '),
    params: present.map(([, value]) => value),
  };
}

/**
 * A `WHERE` condition. A one-element entry binds nothing and is always applied;
 * a two-element entry binds its value, and drops out when that value is
 * undefined — which is how optional filters disappear instead of matching null.
 */
export type Condition = readonly [sql: string] | readonly [sql: string, value: unknown];

export function whereClause(conditions: Condition[]): {
  sql: string;
  params: unknown[];
} {
  const kept = conditions.filter((c) => c.length === 1 || c[1] !== undefined);
  if (kept.length === 0) return { sql: '', params: [] };

  return {
    sql: ` WHERE ${kept.map((c) => c[0]).join(' AND ')}`,
    params: kept.flatMap((c) => (c.length === 1 ? [] : [c[1]])),
  };
}
