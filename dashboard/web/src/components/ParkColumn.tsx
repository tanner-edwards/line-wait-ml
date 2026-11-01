import { fmtTime, ms } from '../format';
import type { Graded, ParkGrade, Tier } from '../types';
import { Bellwethers } from './Bellwethers';
import { Crowd } from './Crowd';
import { ErrorByHour } from './ErrorByHour';
import { Anomalies, Closures } from './Feeds';
import { Headline } from './Headline';
import { RideAverages, Slices, WorstMisses } from './Tables';
import { ProbabilityHonesty, TrendScorecard } from './Trend';

export function ParkColumn({ park, horizon, live, tier }: {
  park: ParkGrade; horizon: number; live: boolean; tier: Tier;
}) {
  // No by_tier (baselines.json without ride_tiers): fall back to every ride.
  const tiered = tier === 'all' ? undefined : park.by_tier?.[tier];
  const g: Graded = tiered ?? park;
  // Live: run the x-axis past the last poll so forecasts show where things are heading.
  const domain: [number, number] | null = park.first_poll && park.last_poll
    ? [ms(park.first_poll), ms(park.last_poll) + (live ? horizon * 60_000 : 0)]
    : null;

  return (
    <div className="park-col">
      <h2>{park.park_name}</h2>
      <p className="park-meta">
        {park.runs === 0
          ? 'No runs recorded'
          : `${park.runs} runs · ${fmtTime(park.first_poll!)}–${fmtTime(park.last_poll!)} · model ${park.model_versions.join(', ') || '—'}`
            + ` · ${g.rides} ride${g.rides === 1 ? '' : 's'} graded`
            + (tier !== 'all' && !tiered ? ' (no ride tiers, showing all)' : '')}
      </p>
      <div className="cards">
        <Headline scores={g.headline} horizon={horizon} />
        <Bellwethers rides={park.bellwethers} horizon={horizon} domain={domain} />
        <ErrorByHour rows={g.error_by_hour} horizon={horizon} deploys={park.deploy_markers} />
        <Crowd crowd={park.crowd} domain={domain} />
        <TrendScorecard trend={g.trend} />
        <ProbabilityHonesty honesty={g.probability_honesty} />
        <Anomalies items={park.anomalies} />
        <Closures items={park.closures} />
        <Slices park={g} />
        <WorstMisses misses={g.worst_misses} />
        <RideAverages rows={park.ride_averages} />
      </div>
    </div>
  );
}
