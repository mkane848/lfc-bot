import cron from 'node-cron';
import { describe, expect, it } from 'vitest';
import { parseScheduleTime } from '../../src/utils/schedule-parser.js';

function expectCron(result: ReturnType<typeof parseScheduleTime>): string {
  if (!('cron' in result)) {
    throw new Error(`expected a cron result, got error: ${result.error}`);
  }
  expect(cron.validate(result.cron)).toBe(true);
  return result.cron;
}

describe('parseScheduleTime: daily phrases', () => {
  it('parses "every day at 9am"', () => {
    expect(expectCron(parseScheduleTime('every day at 9am'))).toBe('0 9 * * *');
  });

  it('parses "daily at 5:30pm"', () => {
    expect(expectCron(parseScheduleTime('daily at 5:30pm'))).toBe('30 17 * * *');
  });

  it('parses "everyday at 12am" as midnight', () => {
    expect(expectCron(parseScheduleTime('everyday at 12am'))).toBe('0 0 * * *');
  });

  it('parses "every day at 12pm" as noon', () => {
    expect(expectCron(parseScheduleTime('every day at 12pm'))).toBe('0 12 * * *');
  });

  it('is case-insensitive', () => {
    expect(expectCron(parseScheduleTime('Every Day At 9AM'))).toBe('0 9 * * *');
  });
});

describe('parseScheduleTime: weekly phrases', () => {
  it('parses "every monday at 9am"', () => {
    expect(expectCron(parseScheduleTime('every monday at 9am'))).toBe('0 9 * * 1');
  });

  it('parses "every Friday at 5:30pm"', () => {
    expect(expectCron(parseScheduleTime('every Friday at 5:30pm'))).toBe('30 17 * * 5');
  });

  it('parses "every sunday at 8am" as day 0', () => {
    expect(expectCron(parseScheduleTime('every sunday at 8am'))).toBe('0 8 * * 0');
  });
});

describe('parseScheduleTime: invalid input', () => {
  it('rejects unrecognized phrasing', () => {
    const result = parseScheduleTime('sometime soon');
    expect('error' in result).toBe(true);
  });

  it('rejects an unknown day name', () => {
    const result = parseScheduleTime('every someday at 9am');
    expect('error' in result).toBe(true);
  });

  it('rejects an out-of-range hour', () => {
    const result = parseScheduleTime('every day at 13am');
    expect('error' in result).toBe(true);
  });

  it('rejects an out-of-range 24-hour value', () => {
    const result = parseScheduleTime('every day at 25:00');
    expect('error' in result).toBe(true);
  });

  it('rejects an out-of-range minute', () => {
    const result = parseScheduleTime('every day at 9:75am');
    expect('error' in result).toBe(true);
  });

  it('rejects empty input', () => {
    const result = parseScheduleTime('');
    expect('error' in result).toBe(true);
  });
});
