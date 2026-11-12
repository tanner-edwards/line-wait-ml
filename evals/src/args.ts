// Tiny CLI helpers shared by every command.
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
