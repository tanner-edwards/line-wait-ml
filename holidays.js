// All date math runs against a synthetic UTC-midnight timestamp representing
// the calendar day in the resort's local timezone. Doing it this way sidesteps
// DST and runtime-locale drift: we never compare wall-clock times, only whole
// calendar days at a fixed offset.

const DAY_MS = 86400000;

function todayInTimezone(now, timezone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(now).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function dateUTC(year, monthOneBased, day) {
  return Date.UTC(year, monthOneBased - 1, day);
}

function addDays(ts, n) {
  return ts + n * DAY_MS;
}

function dayOfWeek(ts) {
  return new Date(ts).getUTCDay();
}

function nthWeekdayOfMonth(year, month, weekday, n) {
  const firstOfMonth = dateUTC(year, month, 1);
  const firstDow = dayOfWeek(firstOfMonth);
  const offset = (weekday - firstDow + 7) % 7;
  return dateUTC(year, month, 1 + offset + (n - 1) * 7);
}

function lastWeekdayOfMonth(year, month, weekday) {
  const firstOfNextMonth = dateUTC(year, month + 1, 1);
  const lastDayTs = addDays(firstOfNextMonth, -1);
  const lastDow = dayOfWeek(lastDayTs);
  const offset = (lastDow - weekday + 7) % 7;
  return addDays(lastDayTs, -offset);
}

// Anonymous Gregorian computus — Easter Sunday for a given year.
function easter(year) {
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

function holidaysForYear(year) {
  const thanksgiving = nthWeekdayOfMonth(year, 11, 4, 4);
  return [
    dateUTC(year, 1, 1),                  // New Year's Day
    nthWeekdayOfMonth(year, 1, 1, 3),     // MLK Jr. Day (3rd Mon Jan)
    nthWeekdayOfMonth(year, 2, 1, 3),     // Presidents Day (3rd Mon Feb)
    easter(year),                         // Easter Sunday
    lastWeekdayOfMonth(year, 5, 1),       // Memorial Day (last Mon May)
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

export function holidayFeatures(now, timezone = 'America/Los_Angeles') {
  const today = todayInTimezone(now, timezone);
  const year = new Date(today).getUTCFullYear();

  // ±1 year so days_since / days_until resolve cleanly across year boundaries.
  const allHolidays = [
    ...holidaysForYear(year - 1),
    ...holidaysForYear(year),
    ...holidaysForYear(year + 1),
  ].sort((a, b) => a - b);

  const isHoliday = allHolidays.includes(today);
  const nextHoliday = allHolidays.find(h => h >= today);
  const prevHoliday = [...allHolidays].reverse().find(h => h <= today);
  const daysUntil = Math.round((nextHoliday - today) / DAY_MS);
  const daysSince = Math.round((today - prevHoliday) / DAY_MS);

  // Heuristic: a Fri/Sat/Sun/Mon within 3 days of any holiday counts as a
  // holiday weekend. Captures the standard 3-day-weekend pattern around
  // Monday holidays and is close enough for mid-week ones.
  const dow = dayOfWeek(today);
  const isFriToMon = dow === 5 || dow === 6 || dow === 0 || dow === 1;
  const isHolidayWeekend = isFriToMon && (daysUntil <= 3 || daysSince <= 3);

  return {
    is_holiday: isHoliday,
    is_holiday_weekend: isHolidayWeekend,
    days_until_next_holiday: daysUntil,
    days_since_last_holiday: daysSince,
  };
}
