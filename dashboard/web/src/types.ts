// Mirrors the payload built by ml/dashboard/grading.py `grade()`.

export interface HorizonScore {
  horizon: number;
  n: number;
  tolerance: number;
  mae?: number | null;
  mae_persistence?: number | null;
  lift_pct?: number | null;
  hit_rate?: number | null;
  hit_rate_persistence?: number | null;
}

export interface TrendSource {
  n: number;
  accuracy: number | null;
  always_stable_accuracy: number | null;
  per_class: Record<'rising' | 'stable' | 'falling', { recall: number | null; precision: number | null; support: number | null }>;
  matrix: Record<string, Record<string, number>>;
}

export interface ReliabilityBin { n: number; mean_p: number | null; observed: number | null }

export interface HourError { hour: number; horizon: number; mae: number | null; mae_persistence: number | null; n: number }

export type Anomaly =
  | { type: 'big_miss'; ride_id: string; ride_name: string; at: string; target_at: string; horizon: number;
      wait: number; forecast: number; actual: number; err: number }
  | { type: 'fall_call'; ride_id: string; ride_name: string; at: string; until: string; wait: number;
      p_fall_30: number; threshold: number; actual_t30: number | null; fell: boolean | null }
  | { type: 'unusual'; side: 'high' | 'low'; ride_id: string; ride_name: string; at: string; until: string;
      polls: number; peak: number; p10: number; p90: number };

export interface Closure {
  ride_id: string; ride_name: string | null; closed_at: string | null; reopened_at: string | null;
  duration_min: number | null; wait_at_close: number | null; wait_at_reopen?: number | null;
  recovery: { min_after: number; wait: number | null }[]; open?: boolean;
}

export interface Bellwether {
  ride_id: string;
  ride_name: string | null;
  actual: { at: string; wait: number | null; status: string }[];
  forecasts: Record<string, { at: string; value: number | null }[]>;
  mae?: Record<string, number | null>;
}

export interface Miss { ride_id: string; ride_name: string; at: string; horizon: number; forecast: number; actual: number; err: number }

export interface ParkGrade {
  park_id: string;
  park_name: string;
  runs: number;
  first_poll: string | null;
  last_poll: string | null;
  model_versions: string[];
  deploy_markers: { model_version: string; at: string }[];
  headline: HorizonScore[];
  by_model_version: { model_version: string; headline: HorizonScore[] }[];
  slices: { closing: HorizonScore[]; post_reopen: HorizonScore[] };
  trend: Record<string, TrendSource> | null;
  probability_honesty: Partial<Record<'p_fall_30' | 'p_rise_30', ReliabilityBin[]>>;
  error_by_hour: HourError[];
  worst_misses: Miss[];
  crowd: { ratio: { at: string; ratio: number | null }[]; morning_index: number | null };
  anomalies: Anomaly[];
  closures: Closure[];
  bellwethers: Bellwether[];
  ride_averages: { ride_id: string; ride_name: string; avg: number; max: number; min: number; polls: number }[];
}

export interface DayGrade {
  date: string;
  day_type: string;
  generated_at: string;
  baselines_range: [string, string] | null;
  parks: Record<string, ParkGrade>;
}
