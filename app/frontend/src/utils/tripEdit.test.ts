import { tripEditLimits } from './tripEdit';

// Trip Nov 20–22 → travel day Nov 19. Rules mirror backend/src/tripEdit.ts.
const trip = { tripStart: '2026-11-20', tripEnd: '2026-11-22' };

describe('tripEditLimits', () => {
  it('before access opens: purchase bounds, no cap', () => {
    expect(tripEditLimits(trip, '2026-11-15')).toEqual({
      startLocked: false, minStart: '2026-11-15', maxStart: '2027-02-13', endCap: null,
    });
  });

  it('travel day: start can move, end capped at travel day + 9', () => {
    expect(tripEditLimits(trip, '2026-11-19')).toEqual({
      startLocked: false, minStart: '2026-11-19', maxStart: '2026-11-28', endCap: '2026-11-28',
    });
  });

  it('mid-trip: start locked', () => {
    expect(tripEditLimits(trip, '2026-11-21')).toMatchObject({
      startLocked: true, minStart: '2026-11-20', maxStart: '2026-11-20', endCap: '2026-11-28',
    });
  });

  it('a persisted anchor keeps the cap after the start moves out', () => {
    const moved = { tripStart: '2026-11-24', tripEnd: '2026-11-26', accessOpenedOn: '2026-11-19' };
    expect(tripEditLimits(moved, '2026-11-20')?.endCap).toBe('2026-11-28');
  });

  it('after the trip: not editable', () => {
    expect(tripEditLimits(trip, '2026-11-23')).toBeNull();
  });
});
