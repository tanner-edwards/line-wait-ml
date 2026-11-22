// Who a ride is for, by age: TouringPlans reader-survey appeal (0-5) per ride and age group,
// in ageAppeal.json (fetched 2026-11-21). One source for the prompt's `fit low` flag and the
// eval harness's age-fit check, so the two agree by construction.
//
// The app's intake asks for the youngest age; it maps onto the survey groups as follows
// (Tanner, 2026-11-21): under 7 = preschool; 7-9 = grade school; 10-12 = the average of grade
// school and teens; 13-17 = teens; 18 and up, or no persona, = the average of the two adult groups.

import AGE_APPEAL from './ageAppeal.json';

export type Appeal = { preschool?: number; gradeSchool?: number; teens?: number; youngAdult?: number; over30?: number };
const APPEAL = (AGE_APPEAL as { rides: Record<string, Appeal> }).rides;

/** Below this appeal for the party's age band a ride is flagged `fit low`. */
export const AGE_FIT_MIN = 3.7;

export function ageBand(youngestAge: number | null | undefined): { label: string; of: (a: Appeal) => number | undefined } {
  const avg = (...xs: (number | undefined)[]) => {
    const v = xs.filter((x): x is number => x != null);
    return v.length ? v.reduce((s, x) => s + x, 0) / v.length : undefined;
  };
  if (youngestAge == null || youngestAge >= 18) return { label: 'adults', of: a => avg(a.youngAdult, a.over30) };
  if (youngestAge >= 13) return { label: 'teens', of: a => a.teens };
  if (youngestAge >= 10) return { label: '10-12', of: a => avg(a.gradeSchool, a.teens) };
  if (youngestAge >= 7) return { label: '7-9', of: a => a.gradeSchool };
  return { label: 'under 7', of: a => a.preschool };
}

/** Survey appeal of a ride (by its ride_metadata name) for a party whose youngest is this age,
 *  or undefined when the ride has no survey data. */
export function ageAppealFor(rideName: string, youngestAge: number | null | undefined): number | undefined {
  const a = APPEAL[rideName];
  return a ? ageBand(youngestAge).of(a) : undefined;
}

/** 'low' when the party's age band rates the ride under AGE_FIT_MIN; null when it rates fine or
 *  there is no data. Wanted rides and a kid-favorites preference are the prompt's business. */
export function ageFitFor(rideName: string, youngestAge: number | null | undefined): 'low' | null {
  const v = ageAppealFor(rideName, youngestAge);
  return v != null && v < AGE_FIT_MIN ? 'low' : null;
}
