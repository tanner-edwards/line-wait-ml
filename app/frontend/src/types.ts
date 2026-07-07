// Mirrors the Lambda's response shape. If the backend contract changes,
// update both this and the backend's src/types.ts together.

export type DayType = 'weekday' | 'weekend' | 'holiday';

export interface HistoricalBucket {
  offsetMinutes: 0 | 30 | 60 | 90 | 120 | 150;
  timeSlot: string; // e.g. "10:30-11:00"
  wait: number | null; // null when no data for that bucket
  sampleCount: number; // 0 when no data
}

export interface HistoricalAverage {
  dayType: DayType;
  // [t+0, t+30, t+60, t+90, t+120, t+150]. The t+150 slot lets the frontend
  // maintain a full 2-hour lookahead when the next slot is imminent (≤5 min).
  buckets: [HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket, HistoricalBucket];
}

export interface Prediction {
  t10: number; t20: number; t30: number; t40: number; t50: number; t60: number;
  t90: number; t120: number; t150: number;
  trend: 'rising' | 'falling' | 'stable' | 'peak' | 'trough';
  trendDelta30: number;
  confidence: 'high' | 'medium' | 'low';
  updatedAt: string;
}

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
  minutesAgo: number;
  wait: number | null;
  status: string;
}

export interface FullDaySlot {
  timeSlot: string;      // "08:00-08:30" LA-local
  startMinutes: number;  // minutes from midnight
  wait: number | null;
  sampleCount: number;
}

// Closure intelligence — emitted by the backend when status === 'DOWN',
// and briefly after a reopen (postReopenWaitDrop may be true for ~30 min
// after a break closure resolves to a short line).
export interface ClosureProfile {
  closureType: 'blip' | 'break';
  elapsedMinutes: number;
  blipEstimateMinutes: number;
  breakEstimateMinutes: number;
  // Expected wait when the ride reopens (break closures only); null when
  // not enough data or ride hasn't been modeled yet.
  predictedReopenWait: number | null;
  // 'suppressed' when the backend lacks sufficient closure history to
  // produce a reliable estimate (new rides, noisy history). UI falls back
  // to timer-only display.
  confidenceLevel: 'high' | 'suppressed';
  // True briefly after a break closure resolves to a meaningfully below-
  // typical wait — signals the post-reopen opportunity window.
  postReopenWaitDrop: boolean;
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
  historicalBaseline?: HistoricalAverage | null;
  recentHistory: RecentSnapshot[] | null;
  lat: number | null;
  lng: number | null;
  // ISO timestamp of when this ride last transitioned OPERATING → DOWN.
  // Only meaningful while status === 'DOWN'; null otherwise (and null
  // for closures that pre-date the scanner — no backfill).
  closedAt?: string | null;
  // ML-predicted reopen time based on per-ride closure duration history.
  predictedReopenAt?: string | null;
  // Optional in the type because closed/legacy fixtures may not carry it;
  // the live backend always emits it on every ride.
  score?: ScoreResult;
  fullDayForecast?: FullDaySlot[] | null;
  closureProfile?: ClosureProfile | null;
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
  restrictionNote: string | null; // LLM-populated only when a persona factor affected ranking
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
  /** The body text the scanner sent in the push payload. Optional for
   *  back-compat with entries written before the field was added; the
   *  history sheet falls back to recomposing if absent. */
  body?: string | null;
  bucket0Wait?: number | null;
  rideStats?: { p10: number; p50: number; p90: number; sampleCount: number } | null;
  previousWait?: number | null;
  closedAt?: string | null;
  durationMs?: number | null;
  waitAtClose?: number | null;
  // True when this reopen notification represents a post-break opportunity
  // window (wait dropped meaningfully below typical). Drives distinct icon
  // and context line in the notification history sheet.
  isOpportunity?: boolean;
}

// --- Accounts + paywall (mirrors backend src/types.ts) ---

export interface TripRecord {
  tripStart: string;   // YYYY-MM-DD
  tripEnd: string;     // YYYY-MM-DD
  purchasedAt: string; // ISO
  source: 'iap' | 'promo' | 'free';
  promoCode?: string;
}

export interface UserResponse {
  userId: string;
  freeTripClaimed: boolean;
  bypass: boolean;
  isNew: boolean;
  trip: TripRecord | null;
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
