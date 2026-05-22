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

export interface Ride {
  id: string;
  name: string;
  land: string;
  status: string;
  currentWait: number | null;
  historicalAverage: HistoricalAverage | null;
  rideStats: RideStats | null;
  prediction: Prediction | null;
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

export interface ErrorResponse {
  error: string;
  message: string;
  lastUpdated: null;
}
