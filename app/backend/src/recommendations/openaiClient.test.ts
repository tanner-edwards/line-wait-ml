import { invokeRecommendationsOpenAi, _resetForTests, OPENAI_TIMEOUT_MS } from './openaiClient';

const mockCreate = jest.fn();
const mockCtor = jest.fn();

jest.mock('openai', () => ({
  __esModule: true,
  default: jest.fn().mockImplementation((opts: unknown) => {
    mockCtor(opts);
    return { chat: { completions: { create: mockCreate } } };
  }),
}));

function respond(payload: object): void {
  mockCreate.mockResolvedValue(payload);
}

function sentRequest(): Record<string, unknown> {
  return mockCreate.mock.calls[0][0] as Record<string, unknown>;
}

const OK = {
  choices: [{ finish_reason: 'stop', message: { role: 'assistant', content: '{"recommendations":[]}' } }],
  usage: { prompt_tokens: 2400, completion_tokens: 150 },
};

const ORIGINAL = { key: process.env.OPENAI_API_KEY, model: process.env.OPENAI_MODEL_ID };

beforeEach(() => {
  mockCreate.mockReset();
  mockCtor.mockReset();
  _resetForTests();
  process.env.OPENAI_API_KEY = 'test-key';
  delete process.env.OPENAI_MODEL_ID;
});

afterAll(() => {
  if (ORIGINAL.key === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = ORIGINAL.key;
  if (ORIGINAL.model === undefined) delete process.env.OPENAI_MODEL_ID; else process.env.OPENAI_MODEL_ID = ORIGINAL.model;
});

describe('invokeRecommendationsOpenAi request', () => {
  it('joins system blocks into one system message ahead of the user message', async () => {
    respond(OK);
    await invokeRecommendationsOpenAi(['structural', 'persona'], 'hi');
    expect(sentRequest().messages).toEqual([
      { role: 'system', content: 'structural\n\npersona' },
      { role: 'user', content: 'hi' },
    ]);
  });

  it('accepts a plain string system prompt', async () => {
    respond(OK);
    await invokeRecommendationsOpenAi('whole prompt', 'hi');
    expect((sentRequest().messages as { content: string }[])[0].content).toBe('whole prompt');
  });

  it('pins reasoning_effort none, max_completion_tokens 4000, and the default model', async () => {
    respond(OK);
    await invokeRecommendationsOpenAi(['s'], 'hi');
    const req = sentRequest();
    expect(req.reasoning_effort).toBe('none');
    expect(req.max_completion_tokens).toBe(4000);
    expect(req.model).toBe('gpt-6-luna');
    expect(req).not.toHaveProperty('temperature');
  });

  it('uses OPENAI_MODEL_ID when set', async () => {
    process.env.OPENAI_MODEL_ID = 'gpt-6.1-terra';
    respond(OK);
    await invokeRecommendationsOpenAi(['s'], 'hi');
    expect(sentRequest().model).toBe('gpt-6.1-terra');
  });

  it('builds the client with the 8 s timeout and no SDK retries', async () => {
    respond(OK);
    await invokeRecommendationsOpenAi(['s'], 'hi');
    expect(OPENAI_TIMEOUT_MS).toBe(8000);
    expect(mockCtor).toHaveBeenCalledWith({ apiKey: 'test-key', timeout: 8000, maxRetries: 0 });
  });

  it('throws before calling when OPENAI_API_KEY is unset', async () => {
    delete process.env.OPENAI_API_KEY;
    await expect(invokeRecommendationsOpenAi(['s'], 'hi')).rejects.toThrow('OPENAI_API_KEY is not set');
    expect(mockCreate).not.toHaveBeenCalled();
  });
});

describe('invokeRecommendationsOpenAi response', () => {
  it('returns text, usage, finish reason, and elapsed time', async () => {
    respond(OK);
    const r = await invokeRecommendationsOpenAi(['s'], 'hi');
    expect(r.text).toBe('{"recommendations":[]}');
    expect(r.usage).toEqual({ inputTokens: 2400, outputTokens: 150 });
    expect(r.stopReason).toBe('stop');
    expect(r.elapsedMs).toBeGreaterThanOrEqual(0);
  });

  it('nulls usage counts that are missing', async () => {
    respond({ choices: OK.choices });
    const r = await invokeRecommendationsOpenAi(['s'], 'hi');
    expect(r.usage).toEqual({ inputTokens: null, outputTokens: null });
  });

  it.each(['length', 'content_filter'])('throws openai_stop on finish_reason %s', async reason => {
    respond({ choices: [{ finish_reason: reason, message: { content: 'partial' } }] });
    await expect(invokeRecommendationsOpenAi(['s'], 'hi')).rejects.toThrow(`openai_stop:${reason}`);
  });

  it('throws when the response has no text', async () => {
    respond({ choices: [{ finish_reason: 'stop', message: { content: null } }] });
    await expect(invokeRecommendationsOpenAi(['s'], 'hi')).rejects.toThrow('no text content');
  });

  it('propagates SDK errors (timeouts, 401, 5xx) untouched', async () => {
    mockCreate.mockRejectedValue(Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }));
    await expect(invokeRecommendationsOpenAi(['s'], 'hi')).rejects.toThrow('Request timed out.');
  });
});
