import { classifyDayType, isHoliday } from './dayType';

// Helper: build a Date that represents 12:00 PT on the given local calendar day,
// chosen so that the LA-local calendar day is unambiguous regardless of DST.
function laNoon(year: number, month: number, day: number): Date {
  // 19:00 UTC ≈ noon in PT (PDT in summer, PST in winter — both well clear
  // of midnight boundaries). Good enough for classifier tests.
  return new Date(Date.UTC(year, month - 1, day, 19, 0));
}

describe('classifyDayType — weekday vs weekend (non-holiday days)', () => {
  // 2026-05-18 is a Monday; week of Mon May 18 - Sun May 24 is non-holiday.
  it('Monday → weekday', () => {
    expect(classifyDayType(laNoon(2026, 5, 18))).toBe('weekday');
  });
  it('Tuesday → weekday', () => {
    expect(classifyDayType(laNoon(2026, 5, 19))).toBe('weekday');
  });
  it('Wednesday → weekday', () => {
    expect(classifyDayType(laNoon(2026, 5, 20))).toBe('weekday');
  });
  it('Thursday → weekday', () => {
    expect(classifyDayType(laNoon(2026, 5, 21))).toBe('weekday');
  });
  it('Friday → weekend', () => {
    expect(classifyDayType(laNoon(2026, 5, 22))).toBe('weekend');
  });
  it('Saturday → weekend', () => {
    expect(classifyDayType(laNoon(2026, 5, 23))).toBe('weekend');
  });
  it('Sunday → weekend', () => {
    expect(classifyDayType(laNoon(2026, 5, 24))).toBe('weekend');
  });
});

describe('classifyDayType — holidays override day-of-week', () => {
  it("New Year's Day (Thursday in 2026) → holiday, not weekday", () => {
    // 2026-01-01 was a Thursday
    expect(classifyDayType(laNoon(2026, 1, 1))).toBe('holiday');
  });
  it("Independence Day (Saturday in 2026) → holiday, not weekend", () => {
    expect(classifyDayType(laNoon(2026, 7, 4))).toBe('holiday');
  });
  it('Christmas Day → holiday', () => {
    expect(classifyDayType(laNoon(2026, 12, 25))).toBe('holiday');
  });
  it("Mother's Day (a Sunday) → holiday, not weekend", () => {
    // 2nd Sunday of May 2026 = 2026-05-10
    expect(classifyDayType(laNoon(2026, 5, 10))).toBe('holiday');
  });
  it('Black Friday (day after Thanksgiving) → holiday', () => {
    // Thanksgiving 2026 = 4th Thu of November = 2026-11-26; Black Friday = 11-27
    expect(classifyDayType(laNoon(2026, 11, 27))).toBe('holiday');
  });
  it('Easter Sunday 2026 → holiday', () => {
    // Easter 2026 = April 5
    expect(classifyDayType(laNoon(2026, 4, 5))).toBe('holiday');
  });
});

describe('isHoliday', () => {
  it('returns true on Christmas Day', () => {
    expect(isHoliday(laNoon(2026, 12, 25))).toBe(true);
  });
  it('returns false on an ordinary Tuesday', () => {
    expect(isHoliday(laNoon(2026, 5, 19))).toBe(false);
  });
  it('returns true on Memorial Day (last Mon of May)', () => {
    // Last Monday of May 2026 = 2026-05-25
    expect(isHoliday(laNoon(2026, 5, 25))).toBe(true);
  });
  it('returns true on a holiday across a year boundary lookup (Dec 31)', () => {
    expect(isHoliday(laNoon(2026, 12, 31))).toBe(true);
  });
  it('returns true on New Year (Jan 1) — covered by either year window', () => {
    expect(isHoliday(laNoon(2026, 1, 1))).toBe(true);
  });
});

describe('classifyDayType — timezone handling', () => {
  it('classifies based on LA-local calendar day, not UTC date', () => {
    // A timestamp that is 2026-05-25 03:00 UTC is still 2026-05-24 in PT (8 PM Sun PDT).
    // 2026-05-25 PT is Memorial Day; 2026-05-24 PT is a Sunday (non-holiday weekend).
    const earlyUTC = new Date(Date.UTC(2026, 4, 25, 3, 0));
    expect(classifyDayType(earlyUTC)).toBe('weekend'); // it's still Sunday 2026-05-24 in LA
  });

  it('honors an explicit non-default timezone', () => {
    // 2026-06-01 04:00 UTC = 06:00 in Europe/Berlin, but 21:00 the day before
    // (Sunday 2026-05-31) in PT. Confirms the function reads the timezone arg
    // instead of always falling back to LA.
    const ts = new Date(Date.UTC(2026, 5, 1, 4, 0));
    expect(classifyDayType(ts, 'Europe/Berlin')).toBe('weekday'); // Mon 2026-06-01
    expect(classifyDayType(ts)).toBe('weekend');                  // Sun 2026-05-31 in LA
  });
});
