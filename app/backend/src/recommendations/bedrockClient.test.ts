import { invokeRecommendations, _resetForTests } from './bedrockClient';

const mockSend = jest.fn();

jest.mock('@aws-sdk/client-bedrock-runtime', () => ({
  BedrockRuntimeClient: jest.fn().mockImplementation(() => ({ send: mockSend })),
  InvokeModelCommand: jest.fn().mockImplementation((input: unknown) => ({ input })),
}));

function respond(payload: object): void {
  mockSend.mockResolvedValue({ body: new TextEncoder().encode(JSON.stringify(payload)) });
}

function sentBody(): Record<string, unknown> {
  const command = mockSend.mock.calls[0][0] as { input: { body: string } };
  return JSON.parse(command.input.body);
}

const OK = {
  content: [{ type: 'text', text: '{"recommendations":[]}' }],
  stop_reason: 'end_turn',
  usage: { input_tokens: 1234, output_tokens: 56 },
};

const ORIGINAL_MODEL = process.env.BEDROCK_MODEL_ID;

beforeEach(() => {
  mockSend.mockReset();
  _resetForTests();
  process.env.BEDROCK_MODEL_ID = 'test-model';
});

afterAll(() => {
  if (ORIGINAL_MODEL === undefined) delete process.env.BEDROCK_MODEL_ID;
  else process.env.BEDROCK_MODEL_ID = ORIGINAL_MODEL;
});

describe('invokeRecommendations request body', () => {
  it('sends system as an array of text blocks, in order', async () => {
    respond(OK);
    await invokeRecommendations(['structural', 'persona'], 'hi');
    expect(sentBody().system).toEqual([
      { type: 'text', text: 'structural' },
      { type: 'text', text: 'persona' },
    ]);
  });

  it('wraps a plain string system prompt as a one-element block array', async () => {
    respond(OK);
    await invokeRecommendations('whole prompt', 'hi');
    expect(sentBody().system).toEqual([{ type: 'text', text: 'whole prompt' }]);
  });

  it('sends max_tokens 4000 and no thinking, sampling, or output_config keys', async () => {
    delete process.env.BEDROCK_EFFORT;
    respond(OK);
    await invokeRecommendations(['s'], 'hi');
    const body = sentBody();
    expect(body.max_tokens).toBe(4000);
    expect(body.anthropic_version).toBe('bedrock-2023-05-31');
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
    for (const key of ['thinking', 'temperature', 'top_p', 'top_k', 'output_config']) {
      expect(body).not.toHaveProperty(key);
    }
  });

  it('adds output_config.effort only when BEDROCK_EFFORT is set', async () => {
    process.env.BEDROCK_EFFORT = 'low';
    respond(OK);
    await invokeRecommendations(['s'], 'hi');
    expect(sentBody().output_config).toEqual({ effort: 'low' });
    delete process.env.BEDROCK_EFFORT;
  });
});

describe('invokeRecommendations stop_reason handling', () => {
  it('throws bedrock_stop:max_tokens on max_tokens', async () => {
    respond({ ...OK, stop_reason: 'max_tokens' });
    await expect(invokeRecommendations(['s'], 'hi')).rejects.toThrow(/^bedrock_stop:max_tokens/);
  });

  it('throws bedrock_stop:refusal on refusal', async () => {
    respond({ ...OK, stop_reason: 'refusal' });
    await expect(invokeRecommendations(['s'], 'hi')).rejects.toThrow(/^bedrock_stop:refusal/);
  });

  it('returns text, usage, stopReason and elapsedMs on end_turn', async () => {
    respond(OK);
    const result = await invokeRecommendations(['s'], 'hi');
    expect(result.text).toBe('{"recommendations":[]}');
    expect(result.usage).toEqual({ inputTokens: 1234, outputTokens: 56 });
    expect(result.stopReason).toBe('end_turn');
    expect(result.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('uses the first text block, skipping non-text blocks', async () => {
    respond({ ...OK, content: [{ type: 'thinking' }, { type: 'text', text: 'answer' }] });
    const result = await invokeRecommendations(['s'], 'hi');
    expect(result.text).toBe('answer');
  });

  it('returns null usage when the response has none', async () => {
    respond({ content: OK.content, stop_reason: 'end_turn' });
    const result = await invokeRecommendations(['s'], 'hi');
    expect(result.usage).toEqual({ inputTokens: null, outputTokens: null });
  });
});

describe('invokeRecommendations errors', () => {
  it('throws when the response has no text block', async () => {
    respond({ ...OK, content: [{ type: 'thinking' }] });
    await expect(invokeRecommendations(['s'], 'hi')).rejects.toThrow('no text content');
  });

  it('throws when BEDROCK_MODEL_ID is not set', async () => {
    delete process.env.BEDROCK_MODEL_ID;
    await expect(invokeRecommendations(['s'], 'hi')).rejects.toThrow('BEDROCK_MODEL_ID is not set');
    expect(mockSend).not.toHaveBeenCalled();
  });
});
