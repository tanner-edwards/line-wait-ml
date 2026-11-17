// Thin wrapper around @aws-sdk/client-bedrock-runtime.
//
// Lives in its own module so the recommendations handler can be unit-tested
// with a jest.mock of this single function — no Bedrock SDK in the test
// harness.
//
// Reads BEDROCK_MODEL_ID + BEDROCK_REGION from env (set by template.yaml).
// Hard-codes max_tokens at 2000 as the per-call abuse-prevention cap.
//
// Body is deliberately minimal: no thinking, no sampling params
// (temperature/top_p/top_k), no output_config, no cache_control. See spec
// ai-recommendation-expectations.md section 10 for why each is absent.

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const MAX_TOKENS = 2000;

// stop_reason values that mean the text is unusable. The caller's catch
// falls back to the deterministic recommendation path.
const FATAL_STOP_REASONS = new Set(['max_tokens', 'refusal']);

export interface BedrockResult {
  text: string;
  usage: { inputTokens: number | null; outputTokens: number | null };
  stopReason: string | null;
  elapsedMs: number;
}

// Lazy-init the client so cold-start cost is bundled into the first call,
// not the module import.
let client: BedrockRuntimeClient | null = null;
function getClient(): BedrockRuntimeClient {
  if (!client) {
    const region = process.env.BEDROCK_REGION ?? 'us-west-2';
    client = new BedrockRuntimeClient({ region });
  }
  return client;
}

/**
 * Invokes Claude on Bedrock with a system prompt + user message.
 *
 * `system` is an ordered list of text blocks (structural blocks first,
 * persona last, so the prefix stays stable across users). A plain string is
 * still accepted and sent as a single block.
 *
 * Returns the first `text` content block plus usage, stop reason, and wall
 * time. Throws on any AWS / network error, on a response with no text block,
 * and on stop_reason `max_tokens` or `refusal` (message prefix
 * `bedrock_stop:<reason>`). The caller is responsible for catching and
 * falling back to the deterministic recommendation path.
 */
export async function invokeRecommendations(
  system: string[] | string,
  userMessage: string
): Promise<BedrockResult> {
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) {
    throw new Error('BEDROCK_MODEL_ID is not set');
  }

  const systemBlocks = typeof system === 'string' ? [system] : system;

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: MAX_TOKENS,
    system: systemBlocks.map(text => ({ type: 'text', text })),
    messages: [
      { role: 'user', content: userMessage },
    ],
  };

  const command = new InvokeModelCommand({
    modelId,
    contentType: 'application/json',
    accept: 'application/json',
    body: JSON.stringify(body),
  });

  const start = Date.now();
  const response = await getClient().send(command);
  const elapsedMs = Date.now() - start;

  const decoded = new TextDecoder().decode(response.body);
  const parsed = JSON.parse(decoded) as {
    content?: Array<{ type: string; text?: string }>;
    stop_reason?: string | null;
    usage?: { input_tokens?: number; output_tokens?: number };
  };

  const stopReason = parsed.stop_reason ?? null;
  if (stopReason && FATAL_STOP_REASONS.has(stopReason)) {
    throw new Error(`bedrock_stop:${stopReason}`);
  }

  const firstText = parsed.content?.find(c => c.type === 'text')?.text;
  if (!firstText) {
    throw new Error('Bedrock response had no text content');
  }

  return {
    text: firstText,
    usage: {
      inputTokens: typeof parsed.usage?.input_tokens === 'number' ? parsed.usage.input_tokens : null,
      outputTokens: typeof parsed.usage?.output_tokens === 'number' ? parsed.usage.output_tokens : null,
    },
    stopReason,
    elapsedMs,
  };
}

// Test helper — drop the cached client so a different env var picks up next call.
export function _resetForTests(): void {
  client = null;
}
