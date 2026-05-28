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
  offsetMinutes: 0 | 30 | 60 | 90 | 120;
  timeSlot: string;            // e.g. "10:30-11:00"
  wait: number | null;         // null when no average doc exists for this bucket
  sampleCount: number;         // 0 when no doc exists
}

export interface HistoricalAverage {
  dayType: DayType;
  buckets: [HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket]; // [t+0, t+30, t+60, t+90, t+120]
}

// Reserved for vAnytime ML predictions. Always null in v1.
export type Prediction = null;

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
  // Always present on the wire response; optional in the type to allow
  // the pre-scoring assembly stage in handler.ts to build a Ride and
  // then attach the score result.
  score?: ScoreResult;
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
}

// --- v2 recommendations contract ---

export interface Recommendation {
  rideId: string;
  oneLiner: string;          // shown on the card
  paragraph: string;         // shown on the detail screen
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
  recommendations: Recommendation[]; // 10 entries in priority order; app paginates 5+5
}

export interface ErrorResponse {
  error: string;
  message: string;
  lastUpdated: null;
}
