// notification-copy.js
// All user-facing notification copy lives here.
// Edit this file to change what users read in push notifications and history.

/**
 * @param {number|null} ms
 * @returns {string|null}
 */
export function formatDuration(ms) {
  if (!Number.isFinite(ms) || ms <= 0) return null;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 1.25) return 'an hour';
  if (hours < 10) return `${Math.round(hours * 10) / 10} hours`;
  return `${Math.round(hours)} hours`;
}

/**
 * @param {string} type - 'trough' | 'closure' | 'reopen' | 'peak'
 * @param {string|null} rideName
 * @param {string|null} badge - 'star' | 'go' | null
 * @returns {string}
 */
export function notificationTitle(type, rideName, badge) {
  const safeName = rideName ?? 'Ride';
  if (type === 'trough') return `${badge === 'star' ? '⭐' : '✅'} ${safeName}`;
  if (type === 'closure') return `✕ ${safeName}`;
  if (type === 'reopen') return `🎉 ${safeName}`;
  if (type === 'peak') return `🛑 ${safeName}`;
  return safeName;
}

// Tagline pools — six variations per (type, magnitude) tier. The
// "magnitude" axis (mild vs strong) ramps language intensity with the
// actual size of the opportunity / disruption, so a 10-min savings doesn't
// read the same as a 30-min savings. See magnitudeFor() below for the
// thresholds.

// Gold-star troughs are already rare by definition — only one tier.
const TROUGH_STAR_TAGLINES = [
  "Doesn't get better than this.",
  'Run.',
  'Quick — before it climbs.',
  'Genuine rarity.',
  'Drop everything.',
  'Grab it before it goes.',
];

const TROUGH_GO_MILD = [
  'Pretty good window.',
  'Solid time to head over.',
  'Worth a look.',
  'Better than usual.',
  'Decent moment.',
  'Worth pivoting.',
];

const TROUGH_GO_STRONG = [
  'Great window — go now.',
  'Way better than typical.',
  'Big savings if you head over.',
  'This is a steal.',
  "Don't sit on this one.",
  'Major deal — get over there.',
];

// Closure: single tier. The fact-of-going-down doesn't have a meaningful
// magnitude signal in the data we collect today.
const CLOSURE_LINES = [
  'Currently down.',
  'Just went down.',
  'Out of commission for now.',
  'Pick something else for the moment.',
  'On a break.',
  'Halted for now.',
];

// Reopen preambles — combined with "{downtime}." Mild for quick recoveries
// (< 45 min), strong for longer outages. NO_DOWNTIME pool used when
// durationMs isn't known.
const REOPEN_PREAMBLES_MILD = [
  'Back after',
  'Up again after',
  'Quick reset — back after',
  'Brief outage of',
  'Open again after',
  'Back online after',
];

const REOPEN_PREAMBLES_STRONG = [
  'Finally back after',
  'Long outage — back after',
  'Took a while, but back. Down for',
  'Long downtime ended after',
  'Back at last — was down for',
  'Open again after a stretch of',
];

const REOPEN_NO_DOWNTIME_LINES = [
  'Back up.',
  'Just reopened.',
  'Open again.',
  'Up and running.',
  'Reopened.',
  'Back online.',
];

// Opportunity reopens: extended closure + wait dropped significantly.
// These replace the standard reopen body when isOpportunity=true.
const REOPEN_OPPORTUNITY_TAGLINES = [
  'Line cleared during the outage. Go now.',
  'Queue drained. Rare window.',
  'Line reset. Get there before the crowd.',
  'Best time to ride — go now.',
  'Short line won\'t last. Move.',
  'Grab this before it fills back up.',
];

const PEAK_MILD = [
  "Now's not the time.",
  'Skip for now.',
  'Come back later.',
  'Probably not worth it.',
  'Hold off.',
  'Wait it out.',
];

const PEAK_STRONG = [
  'Way more crowded than usual.',
  'Walk on by.',
  'Hard pass right now.',
  'Yikes — peak crowd.',
  "Don't even bother right now.",
  'Brutal wait. Skip.',
];

function pickRandom(arr) {
  return arr[Math.floor(Math.random() * arr.length)];
}

// Picks 'mild' or 'strong' based on the magnitude of the event so the
// tagline language matches how big a deal it actually is. Thresholds:
//   trough/go : ≥ 20 min better than typical → strong
//   reopen    : ≥ 45 min downtime → strong
//   peak      : current ≥ 1.5 × p50 → strong
function magnitudeFor(type, params) {
  if (type === 'trough') {
    if (params.badge === 'star') return 'strong'; // always treated as strong
    const c = params.currentWait;
    const b = params.bucket0Wait;
    if (c == null || b == null) return 'mild';
    return (b - c) >= 20 ? 'strong' : 'mild';
  }
  if (type === 'reopen') {
    if (params.durationMs == null) return 'mild';
    return params.durationMs >= 45 * 60_000 ? 'strong' : 'mild';
  }
  if (type === 'peak') {
    const c = params.currentWait;
    const p50 = params.rideStats?.p50;
    if (c == null || p50 == null) return 'mild';
    return c >= p50 * 1.5 ? 'strong' : 'mild';
  }
  return 'mild';
}

/**
 * @param {{
 *   type: string,
 *   badge?: string|null,
 *   currentWait?: number|null,
 *   bucket0Wait?: number|null,
 *   rideStats?: { p50?: number, p90?: number }|null,
 *   durationMs?: number|null,
 *   waitAtClose?: number|null,
 *   isOpportunity?: boolean,
 * }} params
 * @returns {string}
 */
export function notificationBody(params) {
  const { type, badge = null, currentWait = null, bucket0Wait = null, rideStats = null, durationMs = null, waitAtClose = null, isOpportunity = false } = params;
  const magnitude = magnitudeFor(type, params);

  if (type === 'trough') {
    const waitText = currentWait != null ? `${currentWait} min` : 'a short wait';
    const compare = bucket0Wait != null ? ` — usually ${bucket0Wait} around now` : '';
    let pool;
    if (badge === 'star') pool = TROUGH_STAR_TAGLINES;
    else pool = magnitude === 'strong' ? TROUGH_GO_STRONG : TROUGH_GO_MILD;
    const tagline = pickRandom(pool);
    const lead = badge === 'star' ? waitText : `Only ${waitText}`;
    return `${lead}${compare}. ${tagline}`;
  }

  if (type === 'closure') {
    return pickRandom(CLOSURE_LINES);
  }

  if (type === 'reopen') {
    const downtime = formatDuration(durationMs);
    const nowText = currentWait != null ? `${currentWait} min` : null;
    const closedText = waitAtClose != null ? `${waitAtClose} min` : null;

    // Opportunity reopen: extended closure + meaningful wait drop. Lead with
    // the wait numbers — that's the signal — and add urgency tagline.
    if (isOpportunity) {
      const tagline = pickRandom(REOPEN_OPPORTUNITY_TAGLINES);
      if (closedText && nowText && bucket0Wait != null) {
        return `Back after ${downtime ?? 'a while'}. Wait dropped from ${closedText} to ${nowText} — typical is ${bucket0Wait} min. ${tagline}`;
      }
      if (closedText && nowText) {
        return `Back after ${downtime ?? 'a while'}. Was ${closedText} — now ${nowText}. ${tagline}`;
      }
      if (nowText && bucket0Wait != null) {
        return `Back after ${downtime ?? 'a while'}. Only ${nowText} — usually ${bucket0Wait} around now. ${tagline}`;
      }
      return `Back after ${downtime ?? 'a while'}. ${tagline}`;
    }

    const preamblePool = magnitude === 'strong' ? REOPEN_PREAMBLES_STRONG : REOPEN_PREAMBLES_MILD;
    const base = downtime
      ? `${pickRandom(preamblePool)} ${downtime}.`
      : pickRandom(REOPEN_NO_DOWNTIME_LINES);
    if (closedText && nowText) return `${base} Was ${closedText} at close — now ${nowText}.`;
    if (closedText) return `${base} Was ${closedText} when it closed.`;
    if (nowText) return `${base} Wait posted at ${nowText}.`;
    return base;
  }

  if (type === 'peak') {
    const waitText = currentWait != null ? `${currentWait} min` : 'a long wait';
    const compare = rideStats?.p50 != null ? ` — usually ${rideStats.p50} around now` : '';
    const pool = magnitude === 'strong' ? PEAK_STRONG : PEAK_MILD;
    return `Running at ${waitText}${compare}. ${pickRandom(pool)}`;
  }

  return '';
}
