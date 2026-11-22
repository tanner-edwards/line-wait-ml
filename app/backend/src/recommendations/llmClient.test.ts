import * as bedrockClient from './bedrockClient';
import * as openaiClient from './openaiClient';
import { invokeLlm, configuredProvider } from './llmClient';

jest.mock('./bedrockClient', () => ({ invokeRecommendations: jest.fn() }));
jest.mock('./openaiClient', () => ({ invokeRecommendationsOpenAi: jest.fn() }));

const mockBedrock = bedrockClient.invokeRecommendations as jest.MockedFunction<typeof bedrockClient.invokeRecommendations>;
const mockOpenAi = openaiClient.invokeRecommendationsOpenAi as jest.MockedFunction<typeof openaiClient.invokeRecommendationsOpenAi>;

const ok = (text: string): bedrockClient.BedrockResult => ({ text, usage: { inputTokens: 1, outputTokens: 1 }, stopReason: 'stop', elapsedMs: 5 });

const ORIGINAL = { provider: process.env.LLM_PROVIDER, bedrock: process.env.BEDROCK_MODEL_ID, openai: process.env.OPENAI_MODEL_ID };

beforeEach(() => {
  delete process.env.LLM_PROVIDER;
  process.env.BEDROCK_MODEL_ID = 'haiku-test';
  process.env.OPENAI_MODEL_ID = 'luna-test';
  jest.spyOn(console, 'log').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

afterAll(() => {
  for (const [env, val] of [['LLM_PROVIDER', ORIGINAL.provider], ['BEDROCK_MODEL_ID', ORIGINAL.bedrock], ['OPENAI_MODEL_ID', ORIGINAL.openai]] as const) {
    if (val === undefined) delete process.env[env]; else process.env[env] = val;
  }
});

describe('configuredProvider', () => {
  it('is bedrock unless LLM_PROVIDER is exactly "openai"', () => {
    expect(configuredProvider()).toBe('bedrock');
    process.env.LLM_PROVIDER = 'OpenAI';
    expect(configuredProvider()).toBe('bedrock');
    process.env.LLM_PROVIDER = 'openai';
    expect(configuredProvider()).toBe('openai');
  });
});

describe('invokeLlm', () => {
  it('calls Bedrock only when the provider is unset', async () => {
    mockBedrock.mockResolvedValue(ok('from bedrock'));
    const r = await invokeLlm(['s'], 'u');
    expect(r).toMatchObject({ text: 'from bedrock', provider: 'bedrock', model: 'haiku-test' });
    expect(r.fallbackReason).toBeUndefined();
    expect(mockOpenAi).not.toHaveBeenCalled();
    expect(mockBedrock).toHaveBeenCalledWith(['s'], 'u');
  });

  it('calls OpenAI only when it succeeds', async () => {
    process.env.LLM_PROVIDER = 'openai';
    mockOpenAi.mockResolvedValue(ok('from openai'));
    const r = await invokeLlm(['s'], 'u');
    expect(r).toMatchObject({ text: 'from openai', provider: 'openai', model: 'luna-test' });
    expect(mockBedrock).not.toHaveBeenCalled();
    expect(console.log).toHaveBeenCalledWith('[recs-provider]', expect.stringContaining('"provider":"openai"'));
  });

  it('falls back to Bedrock when OpenAI throws, and records why', async () => {
    process.env.LLM_PROVIDER = 'openai';
    mockOpenAi.mockRejectedValue(Object.assign(new Error('Request timed out.'), { name: 'APIConnectionTimeoutError' }));
    mockBedrock.mockResolvedValue(ok('from bedrock'));
    const r = await invokeLlm(['s'], 'u');
    expect(r).toMatchObject({ text: 'from bedrock', provider: 'bedrock', model: 'haiku-test' });
    expect(r.fallbackReason).toBe('APIConnectionTimeoutError: Request timed out.');
    expect(mockBedrock).toHaveBeenCalledWith(['s'], 'u');
    expect(console.warn).toHaveBeenCalledWith('[recs-provider] openai failed, falling back to bedrock', expect.stringContaining('APIConnectionTimeoutError'));
    expect(console.log).toHaveBeenCalledWith('[recs-provider]', expect.stringContaining('"fallbackReason"'));
  });

  it('names the SDK error class and status, and withholds the 401 body (it echoes the key)', async () => {
    process.env.LLM_PROVIDER = 'openai';
    class AuthenticationError extends Error { status = 401; }
    mockOpenAi.mockRejectedValue(new AuthenticationError('401 Incorrect API key provided: sk-abc***xyz'));
    mockBedrock.mockResolvedValue(ok('from bedrock'));
    const r = await invokeLlm(['s'], 'u');
    expect(r.fallbackReason).toBe('AuthenticationError 401: invalid API key (message withheld)');
    expect(JSON.stringify((console.warn as jest.Mock).mock.calls)).not.toContain('sk-abc');
  });

  it('keeps the message for non-401 SDK errors, clipped', async () => {
    process.env.LLM_PROVIDER = 'openai';
    class InternalServerError extends Error { status = 500; }
    mockOpenAi.mockRejectedValue(new InternalServerError('The server had an error. ' + 'x'.repeat(200)));
    mockBedrock.mockResolvedValue(ok('from bedrock'));
    const r = await invokeLlm(['s'], 'u');
    expect(r.fallbackReason?.startsWith('InternalServerError 500: The server had an error.')).toBe(true);
    expect(r.fallbackReason!.length).toBeLessThan(160);
  });

  it('rethrows the Bedrock error when both providers fail', async () => {
    process.env.LLM_PROVIDER = 'openai';
    mockOpenAi.mockRejectedValue(new Error('openai down'));
    mockBedrock.mockRejectedValue(new Error('Bedrock down'));
    await expect(invokeLlm(['s'], 'u')).rejects.toThrow('Bedrock down');
  });
});
