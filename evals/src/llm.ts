// The one place that talks to Bedrock (Converse API, so any Bedrock model works).
//
// Offline mode: pass --mock (or EVAL_MOCK=1) and every call is answered locally with a
// deterministic fake. That lets the whole pipeline (runs, variants, judging, reports) be
// tested with no AWS credentials and no cost. Mock numbers mean nothing; real runs do.
//
// (OpenAI/Gemini direct-API providers from the earlier model-comparison harness were removed:
// the eval is Bedrock-only now. They are in git history if ever needed.)

import { BedrockRuntimeClient, ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { arg, flag, sleep } from './args';

export const REGION = arg('region', process.env.BEDROCK_REGION ?? process.env.AWS_REGION ?? 'us-west-2')!;
const TIMEOUT_MS = Number(arg('timeout-ms', '60000')); // per call; slower calls are recorded as errors
const BEDROCK_REASONING = arg('bedrock-reasoning-effort'); // gpt-oss on Bedrock: low | medium | high
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
    ...(BEDROCK_REASONING && modelId.includes('gpt-oss') ? { additionalModelRequestFields: { reasoning_effort: BEDROCK_REASONING } } : {}),
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
  if (/PAIRWISE JUDGE/.test(system)) {
    const w = ['X', 'Y', 'tie'][hash(user) % 3];
    text = JSON.stringify({ winner: w, x: { grounding: 3, ranking: 3, copy: 3, constraints: 4 }, y: { grounding: 3, ranking: 3, copy: 3, constraints: 4 }, reason: 'mock verdict' });
  } else if (/ANSWER JUDGE/.test(system)) {
    const h = hash(user);
    const v = (k: number) => 2 + ((h >>> k) % 4); // 2..5
    text = JSON.stringify({ grounding: v(0), ranking: v(3), copy: v(6), constraints: v(9), overall: v(12), summary: 'Mock judgement: picks are plausible but captions are generic.', problems: h % 2 ? ['Mock problem: caption restates the wait time'] : [] });
  } else if (/You grade a theme-park/.test(system)) {
    text = JSON.stringify({ ranking: 3, copy: 3, note: 'mock' });
  } else {
    // Echo the first five ride ids found in the user message ("- Name (<id>) wait=...").
    const ids = [...user.matchAll(/^- .*? \(([^()\s]+)\) wait=/gm)].map(m => m[1]);
    text = JSON.stringify({ recommendations: ids.slice(0, 5).map((id, i) => ({ rideId: id, oneLiner: `Mock tip ${i + 1} (${hash(system) % 97}).`, restrictionNote: null })) });
  }
  return { text, wallMs: performance.now() - t0, serverMs: null, inputTokens: Math.round((system.length + user.length) / 4), outputTokens: Math.round(text.length / 4) };
}

export function converse(modelId: string, system: string, user: string, opts: CallOpts): Promise<CallResult> {
  return MOCK ? converseMock(system, user) : converseBedrock(modelId, system, user, opts);
}
