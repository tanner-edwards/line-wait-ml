// Shared types for the eval harness.
import { Persona, Verdict, VerdictReason } from '../../app/backend/src/types';

/** One ride as the server would see it at request time (raw facts, no derived fields). */
export interface RideFact {
  /** Display name, exactly as in ride_metadata.json. Static facts (height, thrill, ids) are looked up by it. */
  name: string;
  wait: number;
  /** Typical wait for right now (verdict.reasons.typical). */
  usual: number | null;
  verdict: Verdict;
  reason?: VerdictReason;
  walk: number;
  /** Forecast curve t+0, t+30 ... t+150 (6 values). Defaults to flat at `wait`. */
  buckets?: number[];
  /** Best later window from the verdict engine: wait, and minutes from now. */
  window?: { wait: number; inMin: number };
  p10?: number;
  p90?: number;
  minutesSinceReopen?: number | null;
  wanted?: boolean;
}

/** A frozen scenario from the spec (section 11). */
export interface Fixture {
  id: string;
  title: string;
  /** What the scenario tests, in the spec's words. */
  tests: string;
  park: 'disneyland' | 'california-adventure';
  /** Humanized local time as the prompt shows it, e.g. "Saturday 1:30 PM". */
  localTime: string;
  /** Minutes after midnight for localTime (clock math). */
  nowMin: number;
  hours: { open: string; close: string } | null;
  persona: Persona | null;
  /** The ride the guest is standing at (GPS nearest). Its walk is ~0. */
  anchor: RideFact;
  rides: RideFact[];
  weather?: { tempF: number; feelsF: number; conditions: string };
  /** Every value this fixture uses that the spec did not state, so Tanner can confirm them. */
  filled: string[];
  /** Scenario-specific assertions (code). */
  asserts: Assert[];
  /** Spec's expectation in plain words, given to the judge. */
  expectation: string;
  /** Reference answers: `ideal` must pass every code check; `bad` must fail at least one assert. */
  ideal: AnswerRow[];
  bad: AnswerRow[];
  /** True when the bad answer's flaw is one only a code check covers (judge-check then skips it). */
  badIsCodeOnly?: boolean;
}

/** A simple answer used for reference answers: ride by name, caption, note. */
export interface AnswerRow { ride: string; caption: string; note?: string | null }

/** Output entry after the variant has mapped its id back to a ride. */
export interface ResolvedRec {
  /** Ride name, or null when the id did not resolve to a ride in the input. */
  ride: string | null;
  rawId: string;
  oneLiner: string;
  restrictionNote: string | null;
}

/** Derived per-ride fields (spec section 6), computed by the harness for checking. */
export interface DerivedRide extends RideFact {
  id: string;
  land: string;
  heightMinIn: number | null;
  thrillLevel: number | null;
  pregnancyAdvisory: boolean;
  transferRequired: boolean;
  isAnchor: boolean;
  vsUsual: number | null;
  ofUsual: 'far-below' | 'below' | 'about' | 'above' | 'far-above' | null;
  restrictedFor: string[];
  reachableBeforeClose: boolean;
  buckets: number[];
}

export interface BuiltFixture {
  fx: Fixture;
  /** All rides including the anchor, nearest first. */
  rides: DerivedRide[];
  byName: Map<string, DerivedRide>;
  field: 'flat' | 'mixed' | 'bad';
  minutesUntilClose: number | null;
  /** Fixture persona with mustDoRideIds filled from rides marked wanted (one source, spec 6.9). */
  persona: import('../../app/backend/src/types').Persona | null;
}

export type Severity = 'hard' | 'soft';
export interface CheckResult { id: string; label: string; severity: Severity; pass: boolean; detail?: string; scenario?: boolean }

export interface Assert {
  id: string;
  label: string;
  run: (recs: ResolvedRec[], b: BuiltFixture) => string | null; // null = pass, else reason
}

/** One saved model call. Checks are recomputed from `text` at report time. */
export interface RunRecord {
  fixture: string;
  run: number;
  variant: string;
  model: string;
  text?: string;
  error?: string;
  wallMs?: number;
  inputTokens?: number | null;
  outputTokens?: number | null;
  /** Ride names the variant offered the model (after its own filtering). */
  offered: string[];
}
