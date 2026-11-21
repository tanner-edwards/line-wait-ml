// Picks the LLM provider for /v2/recommendations and handles the fallback
// chain: OpenAI (when LLM_PROVIDER=openai) -> Bedrock -> throw. The handler's
// existing catch turns a throw into the deterministic fallbackRecs.
//
// LLM_PROVIDER unset or anything but "openai" means Bedrock only, so a deploy
// with the template defaults changes nothing in production. Flipping to
// OpenAI is a repo variable + redeploy; rolling back is the reverse. See
// internal-docs/operations.md, "LLM provider and prompt".
//
// Both clients are imported as modules (not destructured) so the existing
// jest.mock('./bedrockClient') in handler.test.ts keeps working unchanged.

import * as bedrock from './bedrockClient';
import * as openai from './openaiClient';
import type { BedrockResult } from './bedrockClient';

export type LlmProvider = 'openai' | 'bedrock';

export interface LlmResult extends BedrockResult {
  provider: LlmProvider;
  model: string;
  /** Set when OpenAI was configured but failed and Bedrock answered instead. */
  fallbackReason?: string;
}

export function configuredProvider(): LlmProvider {
  return process.env.LLM_PROVIDER === 'openai' ? 'openai' : 'bedrock';
}

// One line for CloudWatch. OpenAI's 401 body echoes the submitted key
// (masked, but still), so that message is withheld; everything else is
// clipped. The SDK's error classes carry their type in the constructor name.
function describe(err: unknown): string {
  const e = err as { name?: string; message?: string; status?: number; constructor?: { name?: string } };
  const type = e?.constructor?.name && e.constructor.name !== 'Error' ? e.constructor.name : (e?.name ?? 'Error');
  const head = e?.status ? `${type} ${e.status}` : type;
  if (e?.status === 401) return `${head}: invalid API key (message withheld)`;
  return `${head}: ${String(e?.message ?? err).slice(0, 120)}`;
}

/**
 * One call, whichever provider is configured. Logs `[recs-provider]` on
 * success so CloudWatch shows which model answered and whether the OpenAI
 * path fell back. Throws only when the last provider in the chain fails.
 */
export async function invokeLlm(system: string[] | string, userMessage: string): Promise<LlmResult> {
  let fallbackReason: string | undefined;

  if (configuredProvider() === 'openai') {
    try {
      const r = await openai.invokeRecommendationsOpenAi(system, userMessage);
      const out: LlmResult = { ...r, provider: 'openai', model: process.env.OPENAI_MODEL_ID || 'gpt-6-luna' };
      console.log('[recs-provider]', JSON.stringify({ provider: out.provider, model: out.model, elapsedMs: out.elapsedMs }));
      return out;
    } catch (err) {
      fallbackReason = describe(err);
      console.warn('[recs-provider] openai failed, falling back to bedrock', JSON.stringify({ reason: fallbackReason }));
    }
  }

  const r = await bedrock.invokeRecommendations(system, userMessage);
  const out: LlmResult = { ...r, provider: 'bedrock', model: process.env.BEDROCK_MODEL_ID ?? '', ...(fallbackReason ? { fallbackReason } : {}) };
  console.log('[recs-provider]', JSON.stringify({ provider: out.provider, model: out.model, elapsedMs: out.elapsedMs, ...(fallbackReason ? { fallbackReason } : {}) }));
  return out;
}
