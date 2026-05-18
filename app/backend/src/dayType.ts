// Day-type classifier for the waits handler ("what kind of day is it RIGHT NOW
// in Anaheim?"). The cron uses the pre-computed `is_holiday` and `day_of_week`
// fields the collector already writes on each wait_times row, so it does NOT
// need this module — but the handler does, because it has to classify the
// current moment to pick which historical_averages bucket to look up.
//
// Rules:
//   - Holiday list mirrors the existing repo-root holidays.js exactly.
//     (The two implementations stay in sync by hand for v1.)
//   - Holiday > weekday/weekend (a holiday on a Thursday is "holiday").
//   - Weekday  = Mon, Tue, Wed, Thu.
//   - Weekend  = Fri, Sat, Sun.
//
// Timezone: all date math runs against a synthetic UTC-midnight timestamp
// representing the resort's local calendar day. This sidesteps DST and locale
// drift — we never compare wall-clock times, only whole calendar days.

export type DayType = 'weekday' | 'weekend' | 'holiday';

const DAY_MS = 86_400_000;
const DEFAULT_TZ = 'America/Los_Angeles';

function calendarDayUTC(now: Date, timezone: string): number {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(now).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function dateUTC(year: number, monthOneBased: number, day: number): number {
  return Date.UTC(year, monthOneBased - 1, day);
}

function addDays(ts: number, n: number): number {
  return ts + n * DAY_MS;
}

function dayOfWeekUTC(ts: number): number {
  return new Date(ts).getUTCDay();
}

function nthWeekdayOfMonth(
  year: number,
  month: number,
  weekday: number,
  n: number
): number {
  const firstOfMonth = dateUTC(year, month, 1);
  const firstDow = dayOfWeekUTC(firstOfMonth);
  const offset = (weekday - firstDow + 7) % 7;
  return dateUTC(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekdayOfMonth(year: number, month: number, weekday: number): number {
  const firstOfNextMonth = dateUTC(year, month + 1, 1);
  const lastDayTs = addDays(firstOfNextMonth, -1);
  const lastDow = dayOfWeekUTC(lastDayTs);
  const offset = (lastDow - weekday + 7) % 7;
  return addDays(lastDayTs, -offset);
}

// Anonymous Gregorian computus — Easter Sunday for a given year.
function easter(year: number): number {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return dateUTC(year, month, day);
}

function holidaysForYear(year: number): number[] {
  const thanksgiving = nthWeekdayOfMonth(year, 11, 4, 4);
  return [
    dateUTC(year, 1, 1),                  // New Year's Day
    nthWeekdayOfMonth(year, 1, 1, 3),     // MLK Jr. Day (3rd Mon Jan)
    nthWeekdayOfMonth(year, 2, 1, 3),     // Presidents Day (3rd Mon Feb)
    easter(year),                         // Easter Sunday
    nthWeekdayOfMonth(year, 5, 0, 2),     // Mother's Day (2nd Sun May)
    lastWeekdayOfMonth(year, 5, 1),       // Memorial Day (last Mon May)
    nthWeekdayOfMonth(year, 6, 0, 3),     // Father's Day (3rd Sun Jun)
    dateUTC(year, 6, 19),                 // Juneteenth
    dateUTC(year, 7, 4),                  // Independence Day
    nthWeekdayOfMonth(year, 9, 1, 1),     // Labor Day (1st Mon Sep)
    nthWeekdayOfMonth(year, 10, 1, 2),    // Columbus / Indigenous Peoples Day (2nd Mon Oct)
    dateUTC(year, 11, 11),                // Veterans Day
    thanksgiving,                         // Thanksgiving (4th Thu Nov)
    addDays(thanksgiving, 1),             // Black Friday
    dateUTC(year, 12, 24),                // Christmas Eve
    dateUTC(year, 12, 25),                // Christmas Day
    dateUTC(year, 12, 26),                // Day after Christmas
    dateUTC(year, 12, 31),                // New Year's Eve
  ];
}

export function isHoliday(now: Date, timezone: string = DEFAULT_TZ): boolean {
  const today = calendarDayUTC(now, timezone);
  const year = new Date(today).getUTCFullYear();
  const allHolidays = [
    ...holidaysForYear(year - 1),
    ...holidaysForYear(year),
    ...holidaysForYear(year + 1),
  ];
  return allHolidays.includes(today);
}

export function classifyDayType(
  now: Date,
  timezone: string = DEFAULT_TZ
): DayType {
  if (isHoliday(now, timezone)) return 'holiday';

  const today = calendarDayUTC(now, timezone);
  const dow = dayOfWeekUTC(today);
  // Sun=0, Mon=1, ..., Sat=6.
  // Mon-Thu (1-4) = weekday, Fri-Sun (5,6,0) = weekend.
  if (dow >= 1 && dow <= 4) return 'weekday';
  return 'weekend';
}
