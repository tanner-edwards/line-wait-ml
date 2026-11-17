// Prints the server-side prompt inputs (RequestContext + RideLine[]) for a
// live park, built by the same path the /v2/recommendations handler uses
// (prepareRecommendationInputs: park fetch, ride metadata, hours, reopens,
// weather). Never calls Bedrock.
//
// Run from app/backend:
//   FIREBASE_SERVICE_ACCOUNT_JSON="$(cat ../../firebase-key.json)" \
//   NODE_EXTRA_CA_CERTS=$HOME/.zscaler-ca.pem \
//   npx tsx scripts/dump-prompt-inputs.ts disneyland [lat lng] [--count 6] [--at ISO]
//
// lat/lng default to the park's hub. Output: JSON, then one text line per ride
// in the spec 6.13 style (codes only, no UUIDs).

import { prepareRecommendationInputs } from '../src/recommendations/handler';
import { RequestContext, RideLine } from '../src/recommendations/promptInputs';
import { ParkSlug, PARKS } from '../src/types';

const HUBS: Record<ParkSlug, { lat: number; lng: number }> = {
  'disneyland': { lat: 33.8121, lng: -117.9190 },          // Sleeping Beauty Castle hub
  'california-adventure': { lat: 33.8062, lng: -117.9209 }, // Carthay Circle
};

function renderContext(c: RequestContext): string {
  const closes = c.closesAt ? `${c.closesAt} (${c.minutesUntilClose} min)` : 'unknown';
  const out = [
    '<context>',
    `park: ${c.park} | time: ${c.localTime} | closes: ${closes} | field: ${c.field}`,
  ];
  if (c.weather) out.push(`weather: ${c.weather}`);
  if (c.anchor) out.push(`guest at: ${c.anchor.name} (${c.anchor.code})`);
  out.push('</context>');
  return out.join('\n');
}

function renderLine(l: RideLine): string {
  const n = (v: number | null) => (v === null ? 'unknown' : String(v));
  const parts = [
    `${l.code} ${l.name}`,
    `wait ${n(l.wait)}`,
    `arrive ${n(l.arrive)}`,
    `usual ${n(l.usual)}`,
    l.ofUsual ?? 'unknown',
    `vsUsual ${n(l.vsUsual)}`,
    `walk ${n(l.walk)}`,
    `verdict ${l.verdict}${l.reason !== 'none' ? ` ${l.reason}` : ''}`,
    `wanted ${l.wanted ? 'yes' : 'no'}`,
    `restricted ${l.restricted.length ? l.restricted.join(',') : 'none'}`,
  ];
  if (l.reopenedMinAgo !== null) parts.push(`reopened ${l.reopenedMinAgo} min ago`);
  parts.push(`buckets ${l.buckets.map(b => (b === null ? '-' : b)).join(',')}`);
  parts.push(`window ${l.window ? `${l.window.wait}min at ${l.window.at}` : 'none'}`);
  if (l.isAnchor) parts.push('anchor yes');
  return parts.join(' | ');
}

async function main() {
  const args = process.argv.slice(2);
  const flag = (name: string) => {
    const i = args.indexOf(name);
    if (i < 0) return undefined;
    const v = args[i + 1];
    args.splice(i, 2);
    return v;
  };
  const count = flag('--count');
  const atRaw = flag('--at');
  const [slugArg, latArg, lngArg] = args;
  const slug = (slugArg ?? 'disneyland') as ParkSlug;
  if (!(slug in PARKS)) {
    console.error(`Unknown park "${slug}". One of: ${Object.keys(PARKS).join(', ')}`);
    process.exit(2);
  }
  const hub = HUBS[slug];
  const inputs = await prepareRecommendationInputs({
    park: slug,
    userLat: latArg ? Number(latArg) : hub.lat,
    userLng: lngArg ? Number(lngArg) : hub.lng,
    count: count ? Number(count) : 6,
    at: atRaw ? new Date(atRaw) : undefined,
  });

  console.log(JSON.stringify({ requestContext: inputs.requestContext, rides: inputs.lines }, null, 2));
  console.log('');
  console.log(renderContext(inputs.requestContext));
  console.log('<rides>');
  for (const l of inputs.lines) console.log(renderLine(l));
  console.log('</rides>');
  console.log(`Return JSON with up to ${inputs.requestContext.batchSize} recommendations in rank order.`);
  if (inputs.lines.length === 0) console.log('(empty candidate pool: park closed, nothing operating, or nothing reachable before close)');
  process.exit(0);
}

main().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
