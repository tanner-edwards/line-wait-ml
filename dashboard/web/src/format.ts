const LA = 'America/Los_Angeles';

const timeFmt = new Intl.DateTimeFormat('en-US', { timeZone: LA, hour: 'numeric', minute: '2-digit' });
const hourFmt = new Intl.DateTimeFormat('en-US', { timeZone: LA, hour: 'numeric' });
const dateFmt = new Intl.DateTimeFormat('en-US', { timeZone: LA, weekday: 'short', month: 'short', day: 'numeric' });
const isoDateFmt = new Intl.DateTimeFormat('en-CA', { timeZone: LA, year: 'numeric', month: '2-digit', day: '2-digit' });

export const ms = (iso: string) => new Date(iso).getTime();
export const fmtTime = (v: string | number) => timeFmt.format(new Date(v));
export const fmtHourTick = (v: number) => hourFmt.format(new Date(v)).replace(' ', '').toLowerCase();
export const fmtDate = (isoDate: string) => dateFmt.format(new Date(`${isoDate}T12:00:00-08:00`));

/** YYYY-MM-DD for "today in LA" shifted by `days`. */
export function laDate(days = 0): string {
  return isoDateFmt.format(new Date(Date.now() + days * 86_400_000));
}

/** "4p" style label for an LA clock hour 0-23. */
export function fmtClockHour(h: number): string {
  const suffix = h < 12 ? 'a' : 'p';
  const hh = h % 12 === 0 ? 12 : h % 12;
  return `${hh}${suffix}`;
}

export const num = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? '—' : v.toFixed(digits).replace(/\.0+$/, '');
export const pct = (v: number | null | undefined) => (v == null ? '—' : `${Math.round(v * 100)}%`);
export const signed = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : `${v > 0 ? '+' : ''}${num(v, digits)}`;

/** Tick positions on whole LA hours inside [start, end] (LA has no sub-hour offset). */
export function hourTicks([start, end]: [number, number], maxTicks = 6): number[] {
  const hour = 3_600_000;
  const first = Math.ceil(start / hour) * hour;
  const count = Math.max(0, Math.floor((end - first) / hour) + 1);
  const step = Math.max(1, Math.ceil(count / maxTicks));
  return Array.from({ length: Math.ceil(count / step) }, (_, i) => first + i * step * hour);
}
