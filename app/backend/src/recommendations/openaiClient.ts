// Thin wrapper around the OpenAI SDK (chat completions), the twin of
// bedrockClient.ts. Lives in its own module so llmClient.ts and the handler
// can be unit-tested with a jest.mock of this single function.
//
// Why this exists (2026-11-20): GPT-6 Luna beat Haiku 4.5 and 5.5 on the
// intent prompt (13/14 scenarios, p50 1.9 s, ~$0.0003/call), and Bedrock
// denies every GPT-6 and Claude 5 model on this AWS account, so Luna comes
// through the OpenAI API directly. Bedrock stays as the fallback (llmClient.ts).
//
// Reads OPENAI_API_KEY + OPENAI_MODEL_ID from env (set by template.yaml).
// reasoning_effort is pinned to "none": GPT-6 rejects "minimal", and "none"
// is the floor (0 reasoning tokens, ~150 output tokens, ~2 s). Anything
// higher makes Luna 2-3x slower for no measurable caption gain.
//
// Timeout is 8 s with no SDK retries (Tanner, 2026-11-20): Luna's p95 is
// 2.6 s, and a retry would mostly double the wait on a bad day. The caller
// falls back to Bedrock on any throw.

import OpenAI from 'openai';
import type { BedrockResult } from './bedrockClient';

const MAX_TOKENS = 4000;
export const OPENAI_TIMEOUT_MS = 8000;
const REASONING_EFFORT = 'none';
const DEFAULT_MODEL_ID = 'gpt-6-luna';

// finish_reason values that mean the text is unusable.
const FATAL_FINISH_REASONS = new Set(['length', 'content_filter']);

// Lazy-init the client so cold-start cost is bundled into the first call.
let client: OpenAI | null = null;
function getClient(): OpenAI {
  if (!client) {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      throw new Error('OPENAI_API_KEY is not set');
    }
    client = new OpenAI({ apiKey, timeout: OPENAI_TIMEOUT_MS, maxRetries: 0 });
  }
  return client;
}

/**
 * Invokes the configured OpenAI model with a system prompt + user message.
 * Same contract as bedrockClient.invokeRecommendations: system blocks are
 * joined into one system message, and the result has the same shape.
 *
 * Throws on any network/API error or timeout, on an empty response, and on
 * finish_reason `length` or `content_filter` (message prefix
 * `openai_stop:<reason>`). The caller (llmClient.ts) catches and falls back
 * to Bedrock.
 */
export async function invokeRecommendationsOpenAi(
  system: string[] | string,
  userMessage: string
): Promise<BedrockResult> {
  const model = process.env.OPENAI_MODEL_ID || DEFAULT_MODEL_ID;
  const systemText = typeof system === 'string' ? system : system.join('\n\n');

  const start = Date.now();
  const res = await getClient().chat.completions.create({
    model,
    messages: [
      { role: 'system', content: systemText },
      { role: 'user', content: userMessage },
    ],
    max_completion_tokens: MAX_TOKENS,
    reasoning_effort: REASONING_EFFORT,
  });
  const elapsedMs = Date.now() - start;

  const choice = res.choices?.[0];
  const stopReason = choice?.finish_reason ?? null;
  if (stopReason && FATAL_FINISH_REASONS.has(stopReason)) {
    throw new Error(`openai_stop:${stopReason}`);
  }

  const text = choice?.message?.content;
  if (!text) {
    throw new Error('OpenAI response had no text content');
  }

  return {
    text,
    usage: {
      inputTokens: typeof res.usage?.prompt_tokens === 'number' ? res.usage.prompt_tokens : null,
      outputTokens: typeof res.usage?.completion_tokens === 'number' ? res.usage.completion_tokens : null,
    },
    stopReason,
    elapsedMs,
  };
}

// Test helper: drop the cached client so a different env var picks up next call.
export function _resetForTests(): void {
  client = null;
}
