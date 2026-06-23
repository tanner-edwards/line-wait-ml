export type ParkSlug = 'disneyland' | 'california-adventure';

export interface ParkInfo {
  id: string;
  name: string;
}

export const PARKS: Record<ParkSlug, ParkInfo> = {
  'disneyland': {
    id: '7340550b-c14d-4def-80bb-acdb51d49a66',
    name: 'Disneyland',
  },
  'california-adventure': {
    id: '832fcd51-ea19-4e77-85c7-75d5843b127c',
    name: 'Disney California Adventure',
  },
};

export const PARK_ORDER: ParkSlug[] = ['disneyland', 'california-adventure'];

// --- Raw Themeparks API shapes (only the fields we read) ---

export interface ThemeparksLiveEntity {
  id: string;
  name: string;
  entityType: string;
  status?: string;
  parentId?: string;
  queue?: {
    STANDBY?: { waitTime: number | null };
  };
}

export interface ThemeparksLiveResponse {
  id: string;
  name: string;
  liveData: ThemeparksLiveEntity[];
}

// /entity/{parkId}/schedule — minimal shape we read. Each entry is a date
// (e.g. "2026-05-23") with one or more windows; `type: 'OPERATING'` is the
// regular park-open window we care about. openingTime/closingTime are full
// ISO strings with timezone offset (e.g. "2026-05-23T08:00:00-07:00").
export interface ThemeparksScheduleEntry {
  date: string;            // "YYYY-MM-DD"
  type: string;            // 'OPERATING' | 'TICKETED_EVENT' | 'CLOSED' | ...
  openingTime: string;     // ISO with offset
  closingTime: string;     // ISO with offset
  description?: string;
}

export interface ThemeparksScheduleResponse {
  id: string;
  name: string;
  schedule: ThemeparksScheduleEntry[];
}

// --- Outgoing response shapes ---

// v1 historical-average shape — gets attached to each operating ride.
export type DayType = 'weekday' | 'weekend' | 'holiday';

export interface HistoricalBucket {
  offsetMinutes: 0 | 30 | 60 | 90 | 120 | 150;
  timeSlot: string;            // e.g. "10:30-11:00"
  wait: number | null;         // null when no average doc exists for this bucket
  sampleCount: number;         // 0 when no doc exists
}

export interface HistoricalAverage {
  dayType: DayType;
  // [t+0, t+30, t+60, t+90, t+120, t+150]. The t+150 slot lets the frontend
  // maintain a full 2-hour lookahead when the next slot is imminent (≤5 min).
  buckets: [HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket];
}

export interface Prediction {
  t10: number;
  t20: number;
  t30: number;
  t40: number;
  t50: number;
  t60: number;
  t90: number;
  t120: number;
  t150: number;
  trend: 'rising' | 'falling' | 'stable' | 'peak' | 'trough';
  trendDelta30: number;
  confidence: 'high' | 'medium' | 'low';
  updatedAt: string;
}

// p10/p90 floor/ceiling for a ride on a given dayType. Used by the scoring
// function to contextualise the current wait against the ride's historic
// range. Null for closed rides and rides with insufficient data.
export interface RideStats {
  p10: number;
  p50: number;
  p90: number;
  sampleCount: number;
}

// --- Scoring (moved server-side as of v2; single source of truth for UI + LLM) ---

export type Badge = 'star' | 'go' | 'skip' | null;

export interface FactorBreakdown {
  vsAvg:           { delta: number; points: number } | null;
  vsRange:         { pct: number;  points: number } | null;
  projectedChange: { delta: number; points: number } | null;
  nearTermChange:  { delta: number; points: number } | null;
  // ≥40% swing from the previous observed wait (previous must have been
  // OPERATING — excludes reopens from DOWN). Override: fires 'go'/'skip'
  // badge even when score-based factors don't reach the ±2 threshold.
  rapidChange:     { delta: number; points: number } | null;
}

export interface ScoreResult {
  score:   number;
  badge:   Badge;
  factors: FactorBreakdown;
}

export interface RecentSnapshot {
  timestamp: string;    // ISO 8601 UTC
  minutesAgo: number;   // Math.round((referenceDate − docTimestamp) / 60_000)
  wait: number | null;  // wait_minutes from Firestore; null if ride was unavailable that run
  status: string;       // "OPERATING", "CLOSED", etc.
}

// One 30-minute historical-average slot for the full-day forecast.
// startMinutes is minutes from midnight LA-local (480 = 8:00 AM).
// wait is null when the park was historically not operating that window.
export interface FullDaySlot {
  timeSlot: string;      // "08:00-08:30" LA-local
  startMinutes: number;
  wait: number | null;
  sampleCount: number;
}

export interface Ride {
  id: string;
  name: string;
  land: string;
  status: string;
  currentWait: number | null;
  historicalAverage: HistoricalAverage | null;
  rideStats: RideStats | null;
  prediction: Prediction | null;
  recentHistory: RecentSnapshot[] | null;
  lat: number | null;
  lng: number | null;
  // ISO timestamp of when this ride last transitioned OPERATING → DOWN.
  // Populated by the scanner; only meaningful while status === 'DOWN'.
  // Null for currently-operating rides and for closures that pre-date
  // the scanner (no historical backfill).
  closedAt: string | null;
  // Always present on the wire response; optional in the type to allow
  // the pre-scoring assembly stage in handler.ts to build a Ride and
  // then attach the score result.
  score?: ScoreResult;
  // 30-min historical-average slots from ~7 AM to midnight. Null when
  // the ride has no historical data at all. Individual slots with
  // wait: null indicate the park was closed during that window historically.
  fullDayForecast?: FullDaySlot[] | null;
}

export interface ParkData {
  park: string;
  lastUpdated: string;
  rides: Ride[];
}

export interface ParkError {
  park: string;
  lastUpdated: null;
  rides: [];
  error: string;
}

export interface CombinedResponse {
  parks: (ParkData | ParkError)[];
}

// Ride lat/lng + park keyed by ride UUID. Seeded by the cron
// populate_ride_metadata.py script from ride_metadata.json at the repo root.
export interface RideMetadata {
  rideId: string;
  parkId: string;
  name: string;
  lat: number | null;
  lng: number | null;
  source: 'manual' | 'themeparks.wiki';
  walkPenaltyMinutes?: number;
  // False for shows, walk-throughs, and transportation that never post a
  // meaningful standby wait. Absent on legacy docs — treat as true.
  tracksWaitTime?: boolean;
}

// --- v2 recommendations contract ---

export interface Recommendation {
  rideId: string;
  oneLiner: string;          // shown on the card
  // paragraph: string;      // [DROPPED] LLM-generated detail copy shown on expand.
                              //   Removed to halve LLM output tokens and speed up first paint.
                              //   May come back as a separate on-demand endpoint when the
                              //   user taps to expand. See promptBuilder.ts TODO(paragraph).
  restrictionNote: string | null; // LLM-populated only when a persona factor affected ranking
  walkMinutes: number | null; // null when either ride lacks lat/lng metadata
  walkYards: number | null;   // null under the same conditions as walkMinutes
  arrivalWait: number | null; // LLM-estimated wait when guest arrives; null when unavailable
}

export interface CurrentRideRef {
  id: string;
  name: string;
  park: ParkSlug;
  lat: number | null;
  lng: number | null;
}

export interface RecommendationsResponse {
  currentRide: CurrentRideRef;
  park: ParkSlug;
  lastUpdated: string;        // ISO timestamp; matches the underlying live-data fetch
  degraded: boolean;          // true when Bedrock failed and we returned deterministic fallback
  recommendations: Recommendation[]; // up to BATCH_SIZE entries per request
  hasMore: boolean;           // true when more candidates exist beyond what's in `recommendations`
}

// --- v3 personalization ---

export type TripDuration = '1-day' | '2-days' | '3-4-days' | '5-plus-days';

export type RideCategory =
  | 'thrills'
  | 'classics'
  | 'immersive'
  | 'kid-favorites'
  | 'shows-characters'
  | 'first-time';

export type AccessibilityNeed =
  | 'stroller'
  | 'wheelchair'
  | 'pregnant'
  | 'sensory'
  | 'none';

// Captured at first-launch onboarding, edited from the Profile tab. Every
// field is independently skippable: null / empty array means "no signal" and
// personaToText() emits no guidance for that field, falling back to the LLM's
// default persona behavior. Sent on each /v2/recommendations call; not stored
// server-side.
export interface Persona {
  tripDuration: TripDuration | null;
  youngestAge: number | null;          // 0–18 inclusive; null = skipped
  ridePreferences: RideCategory[];
  mustDoRideIds: string[];             // ride UUIDs from ride_metadata
  accessibilityNeeds: AccessibilityNeed[];
}

export interface ErrorResponse {
  error: string;
  message: string;
  lastUpdated: null;
}

// --- Promo codes ---

export interface PromoCode {
  type: 'free_trip';
  maxUses: number;
  timesUsed: number;
  expiresAt: string; // ISO
  active: boolean;
}

// --- Accounts + paywall ---

export interface UserRecord {
  userId: string;
  appleId: string;
  email: string | null;
  createdAt: string;
  freeTripClaimed: boolean;
  bypass: boolean;
}

export interface TripRecord {
  tripStart: string;   // YYYY-MM-DD
  tripEnd: string;     // YYYY-MM-DD
  purchasedAt: string; // ISO
  source: 'iap' | 'promo' | 'free';
  promoCode?: string;
}

// Returned by POST /v1/users and GET /v1/users/me
export interface UserResponse {
  userId: string;
  freeTripClaimed: boolean;
  bypass: boolean;
  isNew: boolean;
  trip: TripRecord | null;
}
