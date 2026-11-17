// Validates the AI judges before you trust them: each judge reviews every fixture's IDEAL answer
// (should pass every question) and BAD answer (should fail at least one). Prints how often each
// judge gets it right. Costs ~2 calls per fixture per judge.
//   npm run judge-check [-- --judges a,b] [--fixtures S1,S4] [--mock]
import { readFileSync } from 'fs';
import { join } from 'path';
import { arg, EVALS_ROOT } from './args';
import { buildFixture } from './fixtures/derive';
import { FIXTURES, fixtureById } from './fixtures/scenarios';
import { judgeAnswer, pool } from './judge';
import { AnswerRow, BuiltFixture, ResolvedRec } from './types';

const toRecs = (rows: AnswerRow[]): ResolvedRec[] => rows.map(r => ({ ride: r.ride, rawId: r.ride, oneLiner: r.caption, restrictionNote: r.note ?? null }));

async function main() {
  const judges = (arg('judges') ?? (JSON.parse(readFileSync(join(EVALS_ROOT, 'config', 'judges.json'), 'utf8')) as { judges: string[] }).judges.join(',')).split(',').map(s => s.trim()).filter(Boolean);
  const fixtures = (arg('fixtures')?.split(',').map(fixtureById) ?? FIXTURES).map(buildFixture);
  type Row = { judge: string; b: BuiltFixture; kind: 'ideal' | 'bad' };
  const rows: Row[] = judges.flatMap(judge => fixtures.flatMap(b => (['ideal', 'bad'] as const).filter(k => !(k === 'bad' && b.fx.badIsCodeOnly)).map(kind => ({ judge, b, kind }))));
  console.log(`Judge check: ${judges.length} judge(s), ${rows.length} reviews (ideal + bad per fixture; bad answers whose flaw only code checks cover are skipped)`);
  const res = await pool(rows.map(r => () => judgeAnswer(r.judge, r.b, toRecs(r.b.fx[r.kind]), 0)), 4);

  for (const judge of judges) {
    let right = 0, total = 0;
    console.log(`\n${judge}`);
    rows.forEach((r, i) => {
      if (r.judge !== judge) return;
      const j = res[i];
      total++;
      if (!j) { console.log(`  ??  ${r.b.fx.id.padEnd(4)} ${r.kind.padEnd(5)} unusable reply`); return; }
      const fails = Object.entries(j.results).filter(([, v]) => v?.pass === false);
      const ok = r.kind === 'ideal' ? fails.length === 0 : fails.length > 0;
      if (ok) right++;
      console.log(`  ${ok ? 'ok ' : 'NO '} ${r.b.fx.id.padEnd(4)} ${r.kind.padEnd(5)} ${fails.length ? `failed: ${fails.map(([k, v]) => `${k} (${v!.why.slice(0, 90)})`).join('; ')}` : 'passed everything'}`);
    });
    console.log(`  => ${right}/${total} correct (${Math.round((100 * right) / total)}%). Trust this judge's numbers only if this is high.`);
  }
}

main().catch(err => { console.error('FAILED:', err.message ?? err); process.exit(1); });
