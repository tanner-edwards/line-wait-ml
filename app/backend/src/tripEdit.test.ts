import { tripEditLimits, validateTripEdit } from './tripEdit';

// Trip Nov 20–22 → travel day (access opens) Nov 19.
const trip = { tripStart: '2026-11-20', tripEnd: '2026-11-22' };

describe('validateTripEdit — before access opens', () => {
  const today = '2026-11-15';

  it('allows any move within purchase rules', () => {
    expect(validateTripEdit(trip, '2026-12-01', '2026-12-10', today)).toBeNull();
  });

  it('rejects a start in the past', () => {
    expect(validateTripEdit(trip, '2026-11-14', '2026-11-16', today)).toMatch(/past/);
  });

  it('rejects a start more than 90 days out', () => {
    expect(validateTripEdit(trip, '2027-02-14', '2027-02-15', today)).toMatch(/too far/);
  });

  it('rejects trips longer than 10 days', () => {
    expect(validateTripEdit(trip, '2026-12-01', '2026-12-11', today)).toMatch(/10 days/);
  });

  it('rejects malformed dates and end before start', () => {
    expect(validateTripEdit(trip, '2026-13-01', '2026-12-02', today)).toMatch(/YYYY-MM-DD/);
    expect(validateTripEdit(trip, '2026-12-05', '2026-12-04', today)).toMatch(/on or after/);
  });
});

describe('validateTripEdit — travel day (access open, not started)', () => {
  const today = '2026-11-19';

  it('allows pushing the start back a day for a rest day', () => {
    expect(validateTripEdit(trip, '2026-11-21', '2026-11-23', today)).toBeNull();
  });

  it('caps the end at the travel day + 9', () => {
    expect(validateTripEdit(trip, '2026-11-21', '2026-11-28', today)).toBeNull();
    expect(validateTripEdit(trip, '2026-11-21', '2026-11-29', today)).toMatch(/first day of access/);
  });

  it('reports the anchor so it can be persisted', () => {
    expect(tripEditLimits(trip, today)?.anchor).toBe('2026-11-19');
  });
});

describe('validateTripEdit — persisted anchor', () => {
  // Start was pushed out after access opened on Nov 19; access is closed
  // again, but the anchor still caps the trip.
  const moved = { tripStart: '2026-11-24', tripEnd: '2026-11-26', accessOpenedOn: '2026-11-19' };

  it('keeps the cap even before the new travel day', () => {
    expect(validateTripEdit(moved, '2026-11-25', '2026-11-28', '2026-11-20')).toBeNull();
    expect(validateTripEdit(moved, '2026-11-25', '2026-11-29', '2026-11-20')).toMatch(/first day of access/);
  });

  it('cannot push the start past the cap', () => {
    expect(validateTripEdit(moved, '2026-11-29', '2026-11-29', '2026-11-20')).toMatch(/too far/);
  });
});

describe('validateTripEdit — mid-trip', () => {
  const today = '2026-11-21';

  it('allows extending or shortening the end', () => {
    expect(validateTripEdit(trip, '2026-11-20', '2026-11-25', today)).toBeNull();
    expect(validateTripEdit(trip, '2026-11-20', '2026-11-21', today)).toBeNull();
  });

  it('locks the start', () => {
    expect(validateTripEdit(trip, '2026-11-21', '2026-11-25', today)).toMatch(/only the end date/);
  });

  it('rejects an end in the past', () => {
    expect(validateTripEdit(trip, '2026-11-20', '2026-11-20', today)).toMatch(/past/);
  });
});

describe('validateTripEdit — after the trip', () => {
  it('rejects every edit', () => {
    expect(tripEditLimits(trip, '2026-11-23')).toBeNull();
    expect(validateTripEdit(trip, '2026-11-24', '2026-11-25', '2026-11-23')).toMatch(/ended/);
  });
});
