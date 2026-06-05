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

export interface RecentSnapshot {
  timestamp: string;    // ISO 8601 UTC
  minutesAgo: number;
  wait: number | null;
  status: string;
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
  // Only meaningful while status === 'DOWN'; null otherwise (and null
  // for closures that pre-date the scanner — no backfill).
  closedAt?: string | null;
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
  // paragraph: string;      // [DROPPED] LLM-generated detail copy shown on expand.
                              //   Removed to halve LLM output tokens and speed up first paint.
                              //   May come back via a separate on-demand fetch when the user
                              //   taps to expand. See backend promptBuilder.ts TODO(paragraph).
  walkMinutes: number | null;
  walkYards: number | null;
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
  lastUpdated: string;
  degraded: boolean;
  recommendations: Recommendation[];
  /** True when the backend has more candidates than what's in `recommendations`.
   *  The UI shows "Show more" only while this is true. */
  hasMore: boolean;
}

// --- v3 personalization (mirror of backend src/types.ts) ---

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

export interface Persona {
  tripDuration: TripDuration | null;
  youngestAge: number | null;
  ridePreferences: RideCategory[];
  mustDoRideIds: string[];
  accessibilityNeeds: AccessibilityNeed[];
}

export type DailyParks = 'disneyland' | 'california-adventure' | 'both';

export interface DailyContext {
  date: string;   // YYYY-MM-DD in the user's local timezone
  parks: DailyParks;
}

export type NotificationKind = 'trough' | 'closure' | 'reopen' | 'peak';
export type NotificationTypes = Record<NotificationKind, boolean>;
export const NOTIFICATION_KINDS: readonly NotificationKind[] = ['trough', 'closure', 'reopen', 'peak'];
export function defaultNotificationTypes(): NotificationTypes {
  return { trough: true, closure: true, reopen: true, peak: false };
}

// Mirror of the backend's notificationLog.ts NotificationLogEntry. Used by
// the in-app history sheet (GET /v1/devices/:id/notifications).
export interface NotificationLogEntry {
  deviceId: string;
  rideId: string;
  rideName: string | null;
  type: NotificationKind;
  badge: 'star' | 'go' | null;
  firedAt: string;
  expiresAt: string;
  currentWait: number | null;
  delivered: boolean;
  deliveryError: string | null;
  bucket0Wait?: number | null;
  rideStats?: { p10: number; p50: number; p90: number; sampleCount: number } | null;
  previousWait?: number | null;
  closedAt?: string | null;
  durationMs?: number | null;
  waitAtClose?: number | null;
}

export function emptyPersona(): Persona {
  return {
    tripDuration: null,
    youngestAge: null,
    ridePreferences: [],
    mustDoRideIds: [],
    accessibilityNeeds: [],
  };
}
