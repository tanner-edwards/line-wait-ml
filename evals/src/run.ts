// Calls the model for every fixture x run with one prompt variant, saving after each round.
import { mkdirSync, writeFileSync } from 'fs';
import { dirname, join } from 'path';
import { arg, EVALS_ROOT, stamp } from './args';
import { buildFixture } from './fixtures/derive';
import { pool } from './judge';
import { converse, REGION } from './llm';
import { Fixture, RunRecord } from './types';
import { Variant } from './variants';

export async function generate(opts: { variant: Variant; fixtures: Fixture[]; runs: number; model: string; out?: string }): Promise<{ file: string; records: RunRecord[] }> {
  const file = opts.out ?? join(EVALS_ROOT, 'results', `${opts.variant.id}-${stamp()}.json`);
  const records: RunRecord[] = [];
  const save = () => {
    mkdirSync(dirname(file), { recursive: true });
    writeFileSync(file, JSON.stringify({ variant: opts.variant.id, model: opts.model, region: REGION, runs: opts.runs, at: new Date().toISOString(), records }, null, 2));
  };
  const built = opts.fixtures.map(buildFixture);
  // Warm-up call so connection setup doesn't land on the first timed answer.
  const w = opts.variant.render(built[0]);
  await converse(opts.model, w.system, w.user, { maxTokens: 2000 }).catch(() => undefined);
  // --concurrency n (default 3): answer calls in flight at once. Each call is still timed on its
  // own, like one Lambda request; keep this small so rate limiting never lands inside a timing.
  const concurrency = Math.max(1, Number(arg('concurrency', '3')));
  for (let run = 1; run <= opts.runs; run++) {
    process.stdout.write(`  run ${run}/${opts.runs} `);
    const tasks = built.map(b => async (): Promise<RunRecord> => {
      const r = opts.variant.render(b);
      const base = { fixture: b.fx.id, run, variant: opts.variant.id, model: opts.model, offered: r.offered };
      try {
        const res = await converse(opts.model, r.system, r.user, { maxTokens: 2000 });
        process.stdout.write('.');
        return { ...base, text: res.text, wallMs: res.wallMs, inputTokens: res.inputTokens, outputTokens: res.outputTokens };
      } catch (err) {
        process.stdout.write('x');
        return { ...base, error: `${(err as Error).name}: ${(err as Error).message.slice(0, 160)}` };
      }
    });
    records.push(...await pool(tasks, concurrency)); // pool keeps fixture order
    save();
    console.log('');
  }
  return { file, records };
}
