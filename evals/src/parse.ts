// Parsing + small stats helpers shared by the runner, the judge and the pack builder.
import { ParsedRec } from './scenarios';

export function pct(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  return sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1))];
}
export const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN);

/** Same fence-stripping the handler does, but we record whether it was needed. */
export function parseModelText(text: string): { recs: ParsedRec[] | null; fenced: boolean; error?: string } {
  const trimmed = text.trim();
  const m = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  const body = m ? m[1].trim() : trimmed;
  try {
    const root = JSON.parse(body) as { recommendations?: unknown };
    if (!Array.isArray(root.recommendations)) return { recs: null, fenced: !!m, error: 'no recommendations array' };
    const recs: ParsedRec[] = [];
    for (const e of root.recommendations as Record<string, unknown>[]) {
      if (typeof e?.rideId !== 'string' || typeof e?.oneLiner !== 'string') return { recs: null, fenced: !!m, error: 'malformed entry' };
      recs.push({ rideId: e.rideId, oneLiner: e.oneLiner, restrictionNote: typeof e.restrictionNote === 'string' ? e.restrictionNote : null });
    }
    return { recs, fenced: !!m };
  } catch (err) {
    return { recs: null, fenced: !!m, error: `invalid JSON: ${(err as Error).message.slice(0, 60)}` };
  }
}

/** Pull the first JSON object out of a model reply, tolerating fences, chatter and chat-UI paste damage. */
export function extractJson(text: string): any {
  const a = text.indexOf('{');
  const z = text.lastIndexOf('}');
  if (a === -1 || z <= a) throw new Error('no JSON object found');
  const body = text.slice(a, z + 1);
  try {
    return JSON.parse(body);
  } catch {
    const cleaned = body
      .replace(/&#x20;|&nbsp;/g, ' ')
      .replace(/&quot;/g, '\\"')
      .replace(/\\(?![\\"/bfnrtu])/g, '');
    return JSON.parse(cleaned);
  }
}
