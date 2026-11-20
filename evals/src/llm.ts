// The one place that talks to Bedrock (Converse API, so any Bedrock model works).
//
// Offline mode: pass --mock (or EVAL_MOCK=1) and every call is answered locally with a
// deterministic fake. That lets the whole pipeline (runs, variants, judging, reports) be
// tested with no AWS credentials and no cost. Mock numbers mean nothing; real runs do.
//
// Anthropic API (2026-11-19): a model id that starts with "claude-" (e.g. claude-haiku-5-5) goes to
// the Anthropic API instead of Bedrock, same prompts and same CallResult. Added because the AWS
// account's quota for every Claude 5-series model is 0 ("not available for this account"). The key
// comes from ANTHROPIC_API_KEY, or from the macOS keychain item "anthropic-api-key" when unset:
//   security add-generic-password -a "$USER" -s anthropic-api-key -w
// Judges keep running on Bedrock; only the answer model is routed.
//
// (OpenAI/Gemini direct-API providers from the earlier model-comparison harness were removed:
// the eval is Bedrock-only now. They are in git history if ever needed.)

import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { execFileSync } from 'node:child_process';
import { arg, flag, sleep } from './args';

export const REGION = arg('region', process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-west-2')!;
const TIMEOUT_MS = Number(arg('timeout-ms', '60000')); // per call; slower calls are recorded as errors
const BEDROCK_REASONING = arg('bedrock-reasoning-effort'); // OpenAI models on Bedrock: low | medium | high
const OPENAI_REASONING = arg('reasoning') ?? BEDROCK_REASONING; // OpenAI API: none | minimal | low | medium | high
const EFFORT = arg('effort');
const THINKING_OFF = arg('thinking') === 'off'; // --thinking off: Claude 5-series think by default; this sends thinking.type=disabled
const LATENCY_OPT = flag('latency-optimized'); // Bedrock latency-optimized inference (limited models/regions)
export const MOCK = flag('mock') || process.env.EVAL_MOCK === '1';

export interface CallResult {
  text: string;
  wallMs: number;
  serverMs: number | null;
  inputTokens: number | null;
  outputTokens: number | null;
}
export interface CallOpts { maxTokens: number; temperature?: number }

let client: BedrockRuntimeClient | null = null;
const getClient = () => (client ??= new BedrockRuntimeClient({ region: REGION }));

async function converseBedrock(modelId: string, system: string, user: string, opts: CallOpts): Promise<CallResult> {
  const cmd = new ConverseCommand({
    modelId,
    system: [{ text: system }],
    messages: [{ role: 'user', content: [{ text: user }] }],
    inferenceConfig: { maxTokens: opts.maxTokens, ...(opts.temperature !== undefined ? { temperature: opts.temperature } : {}) },
    ...(BEDROCK_REASONING && modelId.includes('openai') ? { additionalModelRequestFields: { reasoning_effort: BEDROCK_REASONING } } : {}),
    // --effort low|medium|high: output_config.effort for Claude models that think by default (Haiku 5.5+).
    ...(modelId.includes('anthropic') && (EFFORT || THINKING_OFF) ? { additionalModelRequestFields: { ...(THINKING_OFF ? { thinking: { type: 'disabled' } } : {}), ...(EFFORT ? { output_config: { effort: EFFORT } } : {}) } } : {}),
    ...(LATENCY_OPT ? { performanceConfig: { latency: 'optimized' as const } } : {}),
  });
  // Retry only throttling, and never count the wait toward latency.
  for (let attempt = 0; ; attempt++) {
    const t0 = performance.now();
    try {
      const res = await getClient().send(cmd, { abortSignal: AbortSignal.timeout(TIMEOUT_MS) });
      const wallMs = performance.now() - t0;
      const text = (res.output?.message?.content ?? []).map(c => ('text' in c ? c.text : '')).join('');
      return {
        text,
        wallMs,
        serverMs: res.metrics?.latencyMs ?? null,
        inputTokens: res.usage?.inputTokens ?? null,
        outputTokens: res.usage?.outputTokens ?? null,
      };
    } catch (err) {
      if ((err as Error).name === 'ThrottlingException' && attempt < 4) { await sleep(2000 * 2 ** attempt); continue; }
      throw err;
    }
  }
}

// ----------------------------------------------------------------- Anthropic API

export const isAnthropicApiModel = (modelId: string) => modelId.startsWith('claude-');

function anthropicKey(): string {
  if (process.env.ANTHROPIC_API_KEY) return process.env.ANTHROPIC_API_KEY;
  try {
    const k = execFileSync('security', ['find-generic-password', '-s', 'anthropic-api-key', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (k) return k;
  } catch { /* fall through */ }
  throw new Error('No Anthropic API key: set ANTHROPIC_API_KEY or add keychain item "anthropic-api-key" (security add-generic-password -a "$USER" -s anthropic-api-key -w)');
}

let anthropic: Anthropic | null = null;
const getAnthropic = () => (anthropic ??= new Anthropic({ apiKey: anthropicKey(), timeout: TIMEOUT_MS, maxRetries: 4 }));

async function converseAnthropic(modelId: string, system: string, user: string, opts: CallOpts): Promise<CallResult> {
  // Claude 5-series models think by default and reject temperature with thinking on, so
  // temperature is not sent on this path. --thinking off disables thinking (accepted by Haiku 5.5,
  // measured 2026-11-19: 1.5 s / 146 out tokens vs 2.3 s / 407 default); --effort low barely helps.
  const t0 = performance.now();
  const res = await getAnthropic().messages.create({
    model: modelId,
    max_tokens: Math.max(opts.maxTokens, 4000), // thinking tokens count toward max_tokens
    system,
    messages: [{ role: 'user', content: user }],
    // Sonnet 5.5 rejects thinking.type=disabled; between_tools is its lowest setting (effort high or below).
    ...(THINKING_OFF ? { thinking: { type: (modelId.startsWith('claude-sonnet-5') ? 'between_tools' : 'disabled') as 'disabled' } } : {}),
    ...(EFFORT ? { output_config: { effort: EFFORT as 'low' | 'medium' | 'high' } } : {}),
  });
  const wallMs = performance.now() - t0;
  const text = res.content.map(c => (c.type === 'text' ? c.text : '')).join('');
  return { text, wallMs, serverMs: null, inputTokens: res.usage.input_tokens ?? null, outputTokens: res.usage.output_tokens ?? null };
}

// ----------------------------------------------------------------- OpenAI API

export const isOpenAiApiModel = (modelId: string) => modelId.startsWith('gpt-');

function openaiKey(): string {
  if (process.env.OPENAI_API_KEY) return process.env.OPENAI_API_KEY;
  try {
    const k = execFileSync('security', ['find-generic-password', '-s', 'openai-api-key', '-w'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (k) return k;
  } catch { /* fall through */ }
  throw new Error('No OpenAI API key: set OPENAI_API_KEY or add keychain item "openai-api-key"');
}

let openai: OpenAI | null = null;
const getOpenAi = () => (openai ??= new OpenAI({ apiKey: openaiKey(), timeout: TIMEOUT_MS, maxRetries: 4 }));

async function converseOpenAi(modelId: string, system: string, user: string, opts: CallOpts): Promise<CallResult> {
  // Eval only (2026-11-20): GPT-6 Luna / 6.1 Terra are gated on Bedrock for this account.
  // --reasoning none|minimal|low controls GPT-6 reasoning; temperature is not sent.
  const t0 = performance.now();
  const res = await getOpenAi().chat.completions.create({
    model: modelId,
    messages: [{ role: 'system', content: system }, { role: 'user', content: user }],
    max_completion_tokens: Math.max(opts.maxTokens, 4000),
    ...(OPENAI_REASONING ? { reasoning_effort: OPENAI_REASONING as 'low' } : {}),
  });
  const wallMs = performance.now() - t0;
  const text = res.choices[0]?.message?.content ?? '';
  return { text, wallMs, serverMs: null, inputTokens: res.usage?.prompt_tokens ?? null, outputTokens: res.usage?.completion_tokens ?? null };
}

// ----------------------------------------------------------------- mock

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}

async function converseMock(system: string, user: string): Promise<CallResult> {
  const t0 = performance.now();
  await sleep(2 + (hash(user) % 8));
  let text: string;
  if (/SPEC JUDGE/.test(system)) {
    const h = hash(user);
    const ids = ['grounded', 'present-tense', 'skip-framing', 'restrictions', 'strongest-reason', 'voice', 'ranking'];
    text = JSON.stringify(Object.fromEntries(ids.map((id, i) => [id, { pass: ((h >>> i) & 3) !== 0, why: 'mock reason' }])));
  } else {
    // Echo the first five rides in the user message: v1 lines "- Name (<id>) wait=..." or spec lines "r3 Name | ...".
    const v1 = [...user.matchAll(/^- .*? \(([^()\s]+)\) wait=/gm)].map(m => m[1]);
    const coded = [...user.matchAll(/^(r\d+) ([^|\n]+?) \|/gm)].map(m => `${m[1]} ${m[2]}`);
    const ids = v1.length ? v1 : coded;
    text = JSON.stringify({ recommendations: ids.slice(0, 5).map((id, i) => ({ rideId: id, oneLiner: `Mock tip ${i + 1} (${hash(system) % 97}).`, restrictionNote: null })) });
  }
  return { text, wallMs: performance.now() - t0, serverMs: null, inputTokens: Math.round((system.length + user.length) / 4), outputTokens: Math.round(text.length / 4) };
}

export function converse(modelId: string, system: string, user: string, opts: CallOpts): Promise<CallResult> {
  if (MOCK) return converseMock(system, user);
  if (isOpenAiApiModel(modelId)) return converseOpenAi(modelId, system, user, opts);
  return isAnthropicApiModel(modelId) ? converseAnthropic(modelId, system, user, opts) : converseBedrock(modelId, system, user, opts);
}
