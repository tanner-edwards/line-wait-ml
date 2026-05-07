import { readFileSync } from 'node:fs';

const DAY_MS = 86400000;
const VALID_TYPES = new Set(['convention', 'race', 'sports', 'competition']);

function todayInTimezone(now, timezone) {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  const [y, m, d] = fmt.format(now).split('-').map(Number);
  return Date.UTC(y, m - 1, d);
}

function parseDate(yyyymmdd) {
  // Treat YYYY-MM-DD as a Pacific calendar day, modeled as UTC midnight.
  const [y, m, d] = yyyymmdd.split('-').map(Number);
  if (!y || !m || !d) return NaN;
  return Date.UTC(y, m - 1, d);
}

export function loadEvents(path = './local_events.json') {
  let raw;
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'));
  } catch (err) {
    console.warn(JSON.stringify({ event: 'local_events_load_failed', error: String(err) }));
    return [];
  }
  if (!Array.isArray(raw)) {
    console.warn(JSON.stringify({ event: 'local_events_invalid', reason: 'root must be an array' }));
    return [];
  }
  const out = [];
  for (const e of raw) {
    const start = parseDate(e?.start_date);
    const end = parseDate(e?.end_date);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) continue;
    if (!VALID_TYPES.has(e.type)) continue;
    out.push({ name: String(e.name || ''), type: e.type, start, end });
  }
  return out;
}

export function localEventFeatures(now, events, timezone = 'America/Los_Angeles') {
  const today = todayInTimezone(now, timezone);

  const activeToday = events.filter(e => today >= e.start && today <= e.end);

  let nextStart = Infinity;
  let prevEnd = -Infinity;
  for (const e of events) {
    if (e.start > today && e.start < nextStart) nextStart = e.start;
    if (e.end < today && e.end > prevEnd) prevEnd = e.end;
  }

  const daysUntil = activeToday.length > 0
    ? 0
    : (Number.isFinite(nextStart) ? Math.round((nextStart - today) / DAY_MS) : null);
  const daysSince = activeToday.length > 0
    ? 0
    : (Number.isFinite(prevEnd) ? Math.round((today - prevEnd) / DAY_MS) : null);

  return {
    local_event_today: activeToday.length > 0,
    local_event_types: activeToday.map(e => e.type),
    local_event_names: activeToday.map(e => e.name),
    days_until_next_local_event: daysUntil,
    days_since_last_local_event: daysSince,
  };
}
