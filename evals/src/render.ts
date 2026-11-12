// Renders a scenario (guest, clock, ride table) as Markdown. Used by the evaluation pack
// for human/agent evaluators and by the automated judge, so both see identical data.
import { personaToText } from '../../app/backend/src/recommendations/persona';
import { BuiltScenario, ParsedRec } from './scenarios';

export function scenarioMarkdown(b: BuiltScenario): string[] {
  const sc = b.scenario;
  const md: string[] = [];
  md.push(`- Park: Disneyland`);
  md.push(`- Local time: ${sc.currentLocalTime}`);
  md.push(`- Park hours today: ${sc.parkHours ? `${sc.parkHours.open}-${sc.parkHours.close}` : 'unknown'}`);
  md.push(`- Guest is currently at: ${b.ctx.currentRide.name} (excluded from the list)`);
  md.push(`\n**Guest persona given to the models:**\n\n> ${personaToText(sc.persona, b.metadataMap).replace(/\n/g, '\n> ')}\n`);
  md.push('**Rides available** (waits in minutes; "usual" = typical wait for right now; "later" = typical wait in 30/60/90 min; "range" = p10-p90 for the day type):\n');
  md.push('| Ride | Wait now | Usual now | Later (30/60/90) | Range | Walk | App verdict | Trend |');
  md.push('|---|---|---|---|---|---|---|---|');
  for (const c of b.candidates) {
    const r = c.ride;
    const bk = r.historicalAverage?.buckets ?? [];
    const later = [1, 2, 3].map(i => bk[i]?.wait ?? '-').join('/');
    const v = r.verdict;
    const trend = (r.prediction as unknown as { trend?: string } | null)?.trend ?? '-';
    md.push(`| ${r.name} | ${r.currentWait ?? '-'} | ${v?.reasons.typical ?? '-'} | ${later} | ${r.rideStats ? `${r.rideStats.p10}-${r.rideStats.p90}` : '-'} | ${c.walkMinutes ?? '?'} min | ${v ? `${v.verdict} (${v.reasons.primary})` : '-'} | ${trend} |`);
  }
  return md;
}

/** `lengths` adds each caption's character count (flagged when over the 80-char card limit). */
export function answerMarkdown(recs: ParsedRec[], b: BuiltScenario, opts: { lengths?: boolean } = {}): string[] {
  const names = new Map(b.candidates.map(c => [c.ride.id, c.ride.name]));
  if (!recs.length) return ['_(empty list: no recommendations)_'];
  return recs.map((r, j) => {
    const len = opts.lengths ? ` [${r.oneLiner.length} chars${r.oneLiner.length > 80 ? ', OVER THE 80-CHAR LIMIT' : ''}]` : '';
    return `${j + 1}. **${names.get(r.rideId) ?? `UNKNOWN RIDE ID ${r.rideId}`}**: "${r.oneLiner}"${len}${r.restrictionNote ? ` _(restriction note: ${r.restrictionNote})_` : ''}`;
  });
}
