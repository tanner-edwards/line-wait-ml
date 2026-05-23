// Thin wrapper around @aws-sdk/client-bedrock-runtime.
//
// Lives in its own module so the recommendations handler can be unit-tested
// with a jest.mock of this single function — no Bedrock SDK in the test
// harness.
//
// Reads BEDROCK_MODEL_ID + BEDROCK_REGION from env (set by template.yaml).
// Hard-codes max_tokens at 2000 as the per-call abuse-prevention cap.

import {
  BedrockRuntimeClient,
  InvokeModelCommand,
} from '@aws-sdk/client-bedrock-runtime';

const MAX_TOKENS = 2000;

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
 * Invokes Claude on Bedrock with a system prompt + user message. Returns the
 * raw text content from the first content block. Throws on any AWS / network
 * error — the caller is responsible for catching and falling back to the
 * deterministic recommendation path.
 */
export async function invokeRecommendations(
  systemPrompt: string,
  userMessage: string
): Promise<string> {
  const modelId = process.env.BEDROCK_MODEL_ID;
  if (!modelId) {
    throw new Error('BEDROCK_MODEL_ID is not set');
  }

  const body = {
    anthropic_version: 'bedrock-2023-05-31',
    max_tokens: MAX_TOKENS,
    system: systemPrompt,
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

  const response = await getClient().send(command);
  const decoded = new TextDecoder().decode(response.body);
  const parsed = JSON.parse(decoded) as {
    content?: Array<{ type: string; text?: string }>;
  };
  const firstText = parsed.content?.find(c => c.type === 'text')?.text;
  if (!firstText) {
    throw new Error('Bedrock response had no text content');
  }
  return firstText;
}

// Test helper — drop the cached client so a different env var picks up next call.
export function _resetForTests(): void {
  client = null;
}
