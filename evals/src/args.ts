// Tiny CLI helpers shared by every command.
import { existsSync, readdirSync } from 'fs';
import { join } from 'path';

export function arg(name: string, fallback?: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i !== -1 ? process.argv[i + 1] : fallback;
}
export const flag = (name: string) => process.argv.includes(`--${name}`);
export const sleep = (ms: number) => new Promise<void>(r => setTimeout(r, ms));

/** The model the app uses today (see app/backend/deploy.sh). Override with BEDROCK_MODEL_ID. */
export const PRODUCTION_MODEL = process.env.BEDROCK_MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/** evals/ package root (results/, config/, history/ live under it). */
export const EVALS_ROOT = join(__dirname, '..');

export const stamp = () => new Date().toISOString().replace(/[:.]/g, '-');

/** A results file path, or a variant name ("baseline") meaning that variant's most recent run in results/. */
export function resolveRun(a: string): string {
  if (existsSync(a)) return a;
  const dir = join(EVALS_ROOT, 'results');
  if (existsSync(join(dir, a))) return join(dir, a);
  const re = new RegExp(`^${a.replace(/[^a-zA-Z0-9-]/g, '')}-\\d{4}-\\d{2}-\\d{2}T.*\\.json$`);
  const hits = existsSync(dir) ? readdirSync(dir).filter(f => re.test(f)).sort() : [];
  if (!hits.length) throw new Error(`No results file or saved run found for "${a}". Run: npm run bench -- --variant ${a} --runs 5`);
  const pick = join(dir, hits[hits.length - 1]);
  console.log(`"${a}" -> ${pick}`);
  return pick;
}

