// Mirrors the Lambda's response shape. If the backend contract changes,
// update both this and the backend's src/types.ts together.

export type DayType = 'weekday' | 'weekend' | 'holiday';

export interface HistoricalBucket {
  offsetMinutes: 0 | 30 | 60 | 90 | 120;
  timeSlot: string; // e.g. "10:30-11:00"
  wait: number | null; // null when no data for that bucket
  sampleCount: number; // 0 when no data
}

export interface HistoricalAverage {
  dayType: DayType;
  buckets: [HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket]; // [t+0, t+30, t+60, t+90, t+120]
}

// Always null in v1; shape reserved for vAnytime when the ML model lands.
export type Prediction = null;

export interface RideStats {
  p10: number;
  p50: number;
  p90: number;
  sampleCount: number;
}

// --- Scoring (computed server-side as of v2; UI is a pure renderer) ---

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
  // Optional in the type because closed/legacy fixtures may not carry it;
  // the live backend always emits it on every ride.
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

export interface ErrorResponse {
  error: string;
  message: string;
  lastUpdated: null;
}

export function isParkError(entry: ParkData | ParkError): entry is ParkError {
  return 'error' in entry;
}

// --- v2 recommendations contract (mirror of the backend's types.ts) ---

export type ParkSlug = 'disneyland' | 'california-adventure';

export interface Recommendation {
  rideId: string;
  oneLiner: string;
  paragraph: string;
  walkMinutes: number | null;
  walkYards: number | null;
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
  lastUpdated: string;
  degraded: boolean;
  recommendations: Recommendation[];
}
