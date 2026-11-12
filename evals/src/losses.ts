// Print the judged pairs the baseline won, from a compare "-details.md" file, so the verdict can be audited.
//   npm run losses -- results/compare-...-details.md [n=4]
import { readFileSync } from 'fs';

const [file, nArg] = process.argv.slice(2);
if (!file) { console.error('Usage: losses.ts <compare-...-details.md> [n]'); process.exit(2); }
const n = Number(nArg ?? '4');
const sections = readFileSync(file, 'utf8').split(/\n(?=## )/).filter(s => s.startsWith('## '));
const lost = sections
  .map(s => ({ s, votes: (s.match(/baseline preferred/g) ?? []).length }))
  .filter(x => x.votes > 0)
  .sort((a, b) => b.votes - a.votes);
console.log(`${lost.length} of ${sections.length} judged pairs had a judge prefer the baseline. Showing the ${Math.min(n, lost.length)} with the most votes:\n`);
for (const x of lost.slice(0, n)) console.log(x.s.trim() + '\n\n----------------------------------------\n');
