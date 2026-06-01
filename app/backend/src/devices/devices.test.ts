import { todayInPT } from './devices';

describe('todayInPT', () => {
  it('returns YYYY-MM-DD format', () => {
    const out = todayInPT();
    expect(out).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });

  it('returns the LA date for a UTC timestamp early in the morning UTC', () => {
    // 2026-06-01 07:00 UTC = 2026-06-01 00:00 PT (DST/PDT, UTC-7)
    // Same calendar day in PT.
    const out = todayInPT(new Date('2026-06-01T07:00:00Z'));
    expect(out).toBe('2026-06-01');
  });

  it('returns the previous LA date when UTC is just past midnight', () => {
    // 2026-06-02 06:00 UTC = 2026-06-01 23:00 PT (UTC-7 in PDT)
    // Still yesterday's date in LA.
    const out = todayInPT(new Date('2026-06-02T06:00:00Z'));
    expect(out).toBe('2026-06-01');
  });

  it('rolls to the next LA date once PT crosses midnight', () => {
    // 2026-06-02 08:00 UTC = 2026-06-02 01:00 PT
    const out = todayInPT(new Date('2026-06-02T08:00:00Z'));
    expect(out).toBe('2026-06-02');
  });
});
