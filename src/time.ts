/**
 * Dates here are local calendar days, not instants.
 *
 * The Worker runs in UTC while the person using it lives in UTC+7. A task added
 * at 22:00 local is already tomorrow in UTC, so deriving "today" from a UTC
 * timestamp would file it under the wrong day — every evening. Every date
 * therefore goes through the configured zone.
 *
 * The zone is a var, not a constant, so it can follow the machine that actually
 * uses this. `Asia/Saigon` and `Asia/Ho_Chi_Minh` are the same zone under two
 * IANA names; either value works.
 */

export const DEFAULT_TZ = 'Asia/Ho_Chi_Minh';

/** The shape every `*_date` column holds. */
export const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

/** Today in `tz` as YYYY-MM-DD. en-CA is the locale that formats dates that way. */
export function todayIn(tz: string): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}

/**
 * Shift a YYYY-MM-DD date by whole days.
 *
 * Deliberately zone-free: it is calendar arithmetic on a date that is already
 * local, so anchoring at UTC midnight cannot drift.
 */
export function shiftDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000)
    .toISOString()
    .slice(0, 10);
}

/** The current instant, as stored in every `*_at` column. */
export function utcNow(): string {
  return new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
}

/** The month a date falls in, as YYYY-MM. */
export const MONTH_PATTERN = /^\d{4}-\d{2}$/;

/**
 * The zone's current offset as a SQLite date modifier, e.g. "+420 minutes".
 *
 * `*_at` columns hold UTC, so grouping them by local month needs a shift — a
 * project created at 23:00 on 31 August local time is already September in UTC.
 * Derived from APP_TZ rather than hardcoded, so changing the zone does not
 * quietly leave the reporting queries behind. Minutes, not hours, because some
 * zones are offset by 30 or 45.
 *
 * This is the offset *now*; a zone that observes DST would report a different
 * one in another season. Fine here, where the zone does not, and where the
 * alternative is per-row zone conversion SQLite cannot do anyway.
 */
export function sqlOffset(tz: string): string {
  const now = new Date();
  const asUtc = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  const asLocal = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const minutes = Math.round((asLocal.getTime() - asUtc.getTime()) / 60_000);
  return `${minutes >= 0 ? '+' : '-'}${Math.abs(minutes)} minutes`;
}

/** A stored UTC instant rendered for a human, e.g. "2026-08-20 17:05". */
export function localTime(iso: string, tz: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date(iso));

  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((p) => p.type === type)?.value ?? '';

  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}
