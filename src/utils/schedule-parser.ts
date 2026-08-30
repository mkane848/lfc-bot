/**
 * Parses a narrow set of natural-language digest schedule phrases into a
 * five-field cron expression. Supports exactly what `digestCron` can
 * represent: one time of day, either every day or on one weekday.
 *
 * Recognized forms (case-insensitive):
 *   - "every day at 9am", "daily at 9:30am", "everyday at 5pm"
 *   - "every monday at 9am", "every Friday at 5:30pm"
 */

const DAY_NAMES: Record<string, number> = {
  sunday: 0,
  monday: 1,
  tuesday: 2,
  wednesday: 3,
  thursday: 4,
  friday: 5,
  saturday: 6,
};

const TIME_PATTERN = /^(\d{1,2})(?::([0-5]\d))?\s*(am|pm)?$/;

export type ScheduleParseResult = { cron: string } | { error: string };

const HELP_MESSAGE =
  "Couldn't understand that time. Try `every day at 9am` or `every monday at 5:30pm`.";

function parseTimeOfDay(raw: string): { hour: number; minute: number } | null {
  const match = TIME_PATTERN.exec(raw.trim());
  if (!match) {
    return null;
  }
  const [, hourStr, minuteStr, meridiem] = match;
  let hour = Number.parseInt(hourStr ?? '', 10);
  const minute = minuteStr ? Number.parseInt(minuteStr, 10) : 0;
  if (Number.isNaN(hour) || Number.isNaN(minute)) {
    return null;
  }

  if (meridiem) {
    if (hour < 1 || hour > 12) {
      return null;
    }
    if (meridiem === 'am') {
      hour = hour === 12 ? 0 : hour;
    } else {
      hour = hour === 12 ? 12 : hour + 12;
    }
  } else if (hour > 23) {
    return null;
  }

  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) {
    return null;
  }
  return { hour, minute };
}

export function parseScheduleTime(input: string): ScheduleParseResult {
  const normalized = input.trim().toLowerCase().replace(/\s+/g, ' ');

  const dailyMatch = /^(?:every day|everyday|daily) at (.+)$/.exec(normalized);
  if (dailyMatch) {
    const time = parseTimeOfDay(dailyMatch[1] ?? '');
    if (!time) {
      return { error: HELP_MESSAGE };
    }
    return { cron: `${time.minute} ${time.hour} * * *` };
  }

  const weeklyMatch = /^every (\w+) at (.+)$/.exec(normalized);
  if (weeklyMatch) {
    const dayName = weeklyMatch[1] ?? '';
    const dayOfWeek = DAY_NAMES[dayName];
    if (dayOfWeek === undefined) {
      return { error: HELP_MESSAGE };
    }
    const time = parseTimeOfDay(weeklyMatch[2] ?? '');
    if (!time) {
      return { error: HELP_MESSAGE };
    }
    return { cron: `${time.minute} ${time.hour} * * ${dayOfWeek}` };
  }

  return { error: HELP_MESSAGE };
}
