// Mirrors the Lambda's response shape. If the backend contract changes,
// update both this and the backend's src/types.ts together.

export type DayType = 'weekday' | 'weekend' | 'holiday';

export interface HistoricalBucket {
  offsetMinutes: 0 | 30 | 60;
  timeSlot: string; // e.g. "10:30-11:00"
  wait: number | null; // null when no data for that bucket
  sampleCount: number; // 0 when no data
}

export interface HistoricalAverage {
  dayType: DayType;
  buckets: [HistoricalBucket, HistoricalBucket, HistoricalBucket]; // [t+0, t+30, t+60]
}

// Always null in v1; shape reserved for vAnytime when the ML model lands.
export type Prediction = null;

export interface RideStats {
  p10: number;
  p90: number;
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
