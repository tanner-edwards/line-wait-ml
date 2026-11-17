// Grades one saved model call against the CURRENT checks (so old runs and new runs stay comparable).
import { codeChecks, runPasses, scenarioChecks } from './checks';
import { parseModelText } from './parse';
import { BuiltFixture, CheckResult, ResolvedRec, RunRecord } from './types';
import { getVariant } from './variants';

export interface Graded { rec: RunRecord; recs: ResolvedRec[] | null; checks: CheckResult[]; passed: boolean }

export function grade(rec: RunRecord, b: BuiltFixture): Graded {
  if (rec.error) {
    const checks: CheckResult[] = [{ id: 'call', label: 'Model call succeeded', severity: 'hard', pass: false, detail: rec.error }];
    return { rec, recs: null, checks, passed: false };
  }
  const rendered = getVariant(rec.variant).render(b);
  const offered = rec.offered?.length ? rec.offered : rendered.offered;
  const p = parseModelText(rec.text ?? '');
  const recs = p.recs ? rendered.decode(p.recs) : null;
  const checks = [...codeChecks(recs, b, offered, p.error), ...scenarioChecks(recs, b, offered)];
  return { rec, recs, checks, passed: runPasses(checks) };
}
