// Variety metrics for a set of answers. Pure functions over caption strings so they
// can run on any saved run (old or new) without a model call.
//
// Three numbers, each 0..1 unless noted:
//   withinRepeat  share of captions in an answer that share a 3-word phrase with
//                 another caption in the SAME answer (the "same few phrases reordered"
//                 complaint). 0 = every caption in an answer is phrased differently.
//   acrossRepeat  share of captions whose opening 3 words also open a caption in a
//                 DIFFERENT answer in the run. 0 = no stock openers across runs.
//   distinctOpeners  distinct opening 3-word phrases / captions, across the run.
// plus topPhrases: the most repeated 4-word phrases across the run, with counts.
//
// Phrases are lowercased, punctuation stripped. Ride names are not removed: a caption
// that repeats a rival's name is still a repeat, which is what a reader notices.

export interface VarietyMetrics {
  withinRepeat: number;
  acrossRepeat: number;
  distinctOpeners: number;
  captions: number;
  topPhrases: { phrase: string; count: number }[];
}

const words = (s: string) => s.toLowerCase().replace(/[^a-z0-9' ]+/g, ' ').split(/\s+/).filter(Boolean);
const grams = (ws: string[], n: number) => { const out: string[] = []; for (let i = 0; i + n <= ws.length; i++) out.push(ws.slice(i, i + n).join(' ')); return out; };

/** @param answers one string[] of captions per answer (one answer = one model call). */
export function variety(answers: string[][]): VarietyMetrics {
  const all = answers.flat();
  if (all.length === 0) return { withinRepeat: 0, acrossRepeat: 0, distinctOpeners: 0, captions: 0, topPhrases: [] };

  // within an answer: a caption repeats if any of its 3-grams appears in another caption of the same answer
  let withinHits = 0;
  for (const a of answers) {
    const sets = a.map(c => new Set(grams(words(c), 3)));
    for (let i = 0; i < sets.length; i++) {
      const others = new Set(sets.flatMap((s, j) => (j === i ? [] : [...s])));
      if ([...sets[i]].some(g => others.has(g))) withinHits++;
    }
  }

  // across answers: opener (first 3 words) seen as an opener in a different answer
  const openerByAnswer = answers.map(a => a.map(c => grams(words(c), 3)[0] ?? words(c).join(' ')));
  let acrossHits = 0;
  for (let i = 0; i < openerByAnswer.length; i++) {
    const elsewhere = new Set(openerByAnswer.flatMap((o, j) => (j === i ? [] : o)));
    for (const o of openerByAnswer[i]) if (elsewhere.has(o)) acrossHits++;
  }
  const openers = openerByAnswer.flat();

  // most repeated 4-grams across the whole run (counted once per caption)
  const counts = new Map<string, number>();
  for (const c of all) for (const g of new Set(grams(words(c), 4))) counts.set(g, (counts.get(g) ?? 0) + 1);
  const topPhrases = [...counts].filter(([, k]) => k >= 2).sort((x, y) => y[1] - x[1]).slice(0, 10).map(([phrase, count]) => ({ phrase, count }));

  return {
    withinRepeat: withinHits / all.length,
    acrossRepeat: acrossHits / all.length,
    distinctOpeners: new Set(openers).size / openers.length,
    captions: all.length,
    topPhrases,
  };
}
