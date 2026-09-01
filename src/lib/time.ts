/**
 * All play dates and reminder hours are Europe/Paris. Cloudflare cron is
 * UTC-only and France shifts between UTC+1 and UTC+2, so nothing in this
 * codebase may derive a date or an hour from UTC directly — it goes through
 * here.
 */

export const DEFAULT_TZ = 'Europe/Paris';

/**
 * A result pasted after midnight still belongs to the previous day. The
 * boundary sits between the digest cutoff (21:00) and a plausible morning
 * start, so 04:00 is the rollover.
 */
export const DAY_ROLLOVER_HOUR = 4;

/** Earliest / latest reminder hour offerable. Below DAY_ROLLOVER_HOUR a
 *  reminder would point at yesterday's play date. */
export const MIN_REMINDER_HOUR = 6;
export const MAX_REMINDER_HOUR = 22;

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(tz: string): Intl.DateTimeFormat {
  let f = formatters.get(tz);
  if (!f) {
    f = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    });
    formatters.set(tz, f);
  }
  return f;
}

export interface LocalParts {
  /** YYYY-MM-DD */
  date: string;
  hour: number;
  minute: number;
}

export function localParts(at: Date, tz: string = DEFAULT_TZ): LocalParts {
  const parts = formatter(tz).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes): string => {
    const p = parts.find((x) => x.type === type);
    if (!p) throw new Error(`missing ${type} in formatted date`);
    return p.value;
  };
  return {
    date: `${get('year')}-${get('month')}-${get('day')}`,
    hour: Number(get('hour')),
    minute: Number(get('minute')),
  };
}

/** Calendar date in the target zone, YYYY-MM-DD. */
export function parisDate(at: Date, tz: string = DEFAULT_TZ): string {
  return localParts(at, tz).date;
}

/** Hour 0-23 in the target zone. */
export function parisHour(at: Date, tz: string = DEFAULT_TZ): number {
  return localParts(at, tz).hour;
}

/**
 * The day a result counts for. Before DAY_ROLLOVER_HOUR local time this is
 * yesterday, so a 00:30 submission lands on the day the player actually played.
 */
export function playDate(at: Date, tz: string = DEFAULT_TZ): string {
  const { date, hour } = localParts(at, tz);
  return hour < DAY_ROLLOVER_HOUR ? addDays(date, -1) : date;
}

/** Pure calendar arithmetic on a YYYY-MM-DD string — no timezone involved. */
export function addDays(isoDate: string, days: number): string {
  const ms = Date.parse(`${isoDate}T00:00:00Z`);
  if (Number.isNaN(ms)) throw new Error(`invalid date: ${isoDate}`);
  return new Date(ms + days * 86_400_000).toISOString().slice(0, 10);
}

/** Whole days from `from` to `to`, both YYYY-MM-DD. Negative if `to` is earlier. */
export function daysBetween(from: string, to: string): number {
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(b)) throw new Error(`invalid date range ${from}..${to}`);
  return Math.round((b - a) / 86_400_000);
}

/** Inclusive list of dates from `from` to `to`. */
export function dateRange(from: string, to: string): string[] {
  const out: string[] = [];
  for (let d = from; daysBetween(d, to) >= 0; d = addDays(d, 1)) out.push(d);
  return out;
}

export function clampReminderHour(hour: number): number {
  if (!Number.isInteger(hour)) return 9;
  return Math.min(MAX_REMINDER_HOUR, Math.max(MIN_REMINDER_HOUR, hour));
}

/** Unix seconds. */
export function nowSeconds(at: Date = new Date()): number {
  return Math.floor(at.getTime() / 1000);
}
