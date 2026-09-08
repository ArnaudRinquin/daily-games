import { describe, expect, test } from 'vitest';
import {
  addDays,
  clampReminderHour,
  dateRange,
  daysBetween,
  localParts,
  parisDate,
  parisHour,
  linkedInPlayDate,
  playDate,
} from '../../src/lib/time';

const at = (iso: string) => new Date(iso);

describe('parisDate / parisHour', () => {
  test('winter is UTC+1', () => {
    expect(localParts(at('2026-01-15T23:30:00Z'))).toEqual({
      date: '2026-01-16',
      hour: 0,
      minute: 30,
    });
  });

  test('summer is UTC+2', () => {
    expect(localParts(at('2026-07-15T22:30:00Z'))).toEqual({
      date: '2026-07-16',
      hour: 0,
      minute: 30,
    });
  });

  test('midnight reports hour 0, never 24', () => {
    expect(parisHour(at('2026-07-15T22:00:00Z'))).toBe(0);
    expect(parisDate(at('2026-07-15T22:00:00Z'))).toBe('2026-07-16');
  });
});

describe('playDate rollover at 04:00 Paris', () => {
  test('03:59 still counts for the previous day', () => {
    // 01:59Z in July = 03:59 Paris on the 15th
    expect(parisHour(at('2026-07-15T01:59:00Z'))).toBe(3);
    expect(playDate(at('2026-07-15T01:59:00Z'))).toBe('2026-07-14');
  });

  test('04:00 starts the new day', () => {
    expect(parisHour(at('2026-07-15T02:00:00Z'))).toBe(4);
    expect(playDate(at('2026-07-15T02:00:00Z'))).toBe('2026-07-15');
  });

  test('a 00:30 submission counts for the day just played', () => {
    expect(playDate(at('2026-07-15T22:30:00Z'))).toBe('2026-07-15');
    expect(playDate(at('2026-01-15T23:30:00Z'))).toBe('2026-01-15');
  });

  test('22:00, after the 21:00 cutoff, still counts for today', () => {
    // 20:00Z in July = 22:00 Paris
    expect(playDate(at('2026-07-15T20:00:00Z'))).toBe('2026-07-15');
  });

  test('crosses the year boundary', () => {
    expect(playDate(at('2026-12-31T23:30:00Z'))).toBe('2026-12-31');
    expect(playDate(at('2027-01-01T04:00:00Z'))).toBe('2027-01-01');
  });
});

describe('linkedInPlayDate rolls over at midnight Pacific', () => {
  test('06:00 Paris in summer is still yesterday\'s puzzle', () => {
    // 04:00Z = 06:00 CEST = 21:00 PDT the day before
    expect(playDate(at('2026-07-15T04:00:00Z'))).toBe('2026-07-15');
    expect(linkedInPlayDate(at('2026-07-15T04:00:00Z'))).toBe('2026-07-14');
  });

  test('09:00 Paris in summer is the new puzzle', () => {
    expect(linkedInPlayDate(at('2026-07-15T06:59:00Z'))).toBe('2026-07-14');
    expect(linkedInPlayDate(at('2026-07-15T07:00:00Z'))).toBe('2026-07-15');
  });

  test('09:00 Paris in winter is the new puzzle', () => {
    expect(linkedInPlayDate(at('2026-01-15T07:59:00Z'))).toBe('2026-01-14');
    expect(linkedInPlayDate(at('2026-01-15T08:00:00Z'))).toBe('2026-01-15');
  });

  test('between the DST switches the gap is 8 hours, not 9', () => {
    // 2026-03-08 US springs forward, Europe waits until 03-29: PDT vs CET
    expect(linkedInPlayDate(at('2026-03-15T06:59:00Z'))).toBe('2026-03-14');
    expect(linkedInPlayDate(at('2026-03-15T07:00:00Z'))).toBe('2026-03-15');
  });
});

describe('DST transitions', () => {
  test('spring forward: 02:00 local never happens, 03:00 still rolls back', () => {
    // 2026-03-29, Europe/Paris jumps 02:00 -> 03:00
    expect(localParts(at('2026-03-29T00:30:00Z')).hour).toBe(1);
    expect(localParts(at('2026-03-29T01:00:00Z')).hour).toBe(3);
    expect(playDate(at('2026-03-29T01:00:00Z'))).toBe('2026-03-28');
    expect(playDate(at('2026-03-29T02:00:00Z'))).toBe('2026-03-29');
  });

  test('fall back: the repeated 02:30 resolves to the same play date twice', () => {
    // 2026-10-25, 02:30 local occurs at both 00:30Z (CEST) and 01:30Z (CET)
    expect(localParts(at('2026-10-25T00:30:00Z')).hour).toBe(2);
    expect(localParts(at('2026-10-25T01:30:00Z')).hour).toBe(2);
    expect(playDate(at('2026-10-25T00:30:00Z'))).toBe('2026-10-24');
    expect(playDate(at('2026-10-25T01:30:00Z'))).toBe('2026-10-24');
  });

  test('the same UTC hour maps to different Paris hours across the year', () => {
    expect(parisHour(at('2026-01-15T08:00:00Z'))).toBe(9); // reminder_hour 9 fires here in winter
    expect(parisHour(at('2026-07-15T07:00:00Z'))).toBe(9); // ...and here in summer
  });
});

describe('calendar helpers', () => {
  test('addDays crosses months and years', () => {
    expect(addDays('2026-01-31', 1)).toBe('2026-02-01');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2028-03-01', -1)).toBe('2028-02-29'); // leap year
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  test('daysBetween is signed and inclusive of neither end', () => {
    expect(daysBetween('2026-01-01', '2026-01-08')).toBe(7);
    expect(daysBetween('2026-01-08', '2026-01-01')).toBe(-7);
    expect(daysBetween('2026-01-01', '2026-01-01')).toBe(0);
  });

  test('daysBetween is unaffected by the DST week', () => {
    expect(daysBetween('2026-03-25', '2026-04-01')).toBe(7);
    expect(daysBetween('2026-10-22', '2026-10-29')).toBe(7);
  });

  test('dateRange is inclusive at both ends', () => {
    expect(dateRange('2026-01-01', '2026-01-03')).toEqual([
      '2026-01-01',
      '2026-01-02',
      '2026-01-03',
    ]);
    expect(dateRange('2026-01-01', '2026-01-01')).toEqual(['2026-01-01']);
    expect(dateRange('2026-01-02', '2026-01-01')).toEqual([]);
  });

  test('invalid dates throw rather than silently produce NaN', () => {
    expect(() => addDays('not-a-date', 1)).toThrow();
    expect(() => daysBetween('2026-01-01', 'nope')).toThrow();
  });
});

describe('clampReminderHour', () => {
  test('keeps hours inside the offerable window', () => {
    expect(clampReminderHour(9)).toBe(9);
    expect(clampReminderHour(6)).toBe(6);
    expect(clampReminderHour(22)).toBe(22);
  });

  test('never returns an hour below the day rollover', () => {
    expect(clampReminderHour(0)).toBe(6);
    expect(clampReminderHour(3)).toBe(6);
    expect(clampReminderHour(23)).toBe(22);
  });

  test('falls back to 09:00 on garbage', () => {
    expect(clampReminderHour(NaN)).toBe(9);
    expect(clampReminderHour(9.5)).toBe(9);
  });
});
