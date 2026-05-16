import { _resetCacheForTests, handler } from './handler';
import * as themeparksClient from './themeparksClient';
import type { APIGatewayProxyEvent } from 'aws-lambda';
import type {
  CombinedResponse,
  ErrorResponse,
  ParkData,
  ParkError,
  ThemeparksLiveResponse,
} from './types';

jest.mock('./themeparksClient');

const mockedClient = themeparksClient as jest.Mocked<typeof themeparksClient>;

// --- Fixtures ---
// Use real UUIDs from the static landMapping so resolveLand returns proper lands.
const SPACE_MTN_ID = '9167db1d-e5e7-46da-a07f-ae30a87bc4c4'; // Tomorrowland
const PETER_PAN_ID = 'c23af6ba-8515-406a-8a48-d0818ba0bfc9'; // Fantasyland
const RADIATOR_ID = 'c60c768b-3461-465c-8f4f-b44b087506fc';  // Cars Land

const disneylandLive: ThemeparksLiveResponse = {
  id: '7340550b-c14d-4def-80bb-acdb51d49a66',
  name: 'Disneyland Park',
  liveData: [
    {
      id: SPACE_MTN_ID,
      name: 'Hyperspace Mountain',
      entityType: 'ATTRACTION',
      status: 'OPERATING',
      queue: { STANDBY: { waitTime: 55 } },
    },
    {
      id: 'show-id',
      name: 'Fantasmic!',
      entityType: 'SHOW',
      status: 'OPERATING',
    },
    {
      id: PETER_PAN_ID,
      name: "Peter Pan's Flight",
      entityType: 'ATTRACTION',
      status: 'CLOSED',
      queue: { STANDBY: { waitTime: null } },
    },
  ],
};

const dcaLive: ThemeparksLiveResponse = {
  id: '832fcd51-ea19-4e77-85c7-75d5843b127c',
  name: 'Disney California Adventure',
  liveData: [
    {
      id: RADIATOR_ID,
      name: 'Radiator Springs Racers',
      entityType: 'ATTRACTION',
      status: 'OPERATING',
      queue: { STANDBY: { waitTime: 80 } },
    },
  ],
};

function buildEvent(
  path: string,
  apiKey: string | null = 'test-api-key'
): APIGatewayProxyEvent {
  const headers = apiKey === null ? {} : { 'x-api-key': apiKey };
  return { path, headers } as unknown as APIGatewayProxyEvent;
}

function setupHappyPath(): void {
  mockedClient.fetchLiveData.mockImplementation(async slug => {
    if (slug === 'disneyland') return disneylandLive;
    if (slug === 'california-adventure') return dcaLive;
    throw new Error('unexpected park slug');
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  _resetCacheForTests();
  process.env.API_KEY = 'test-api-key';
  setupHappyPath();
});

// ----- API key check -----

describe('handler — API key check', () => {
  it('returns 401 when the x-api-key header is missing', async () => {
    const result = await handler(buildEvent('/v0/waits/disneyland', null));
    expect(result.statusCode).toBe(401);
    const body = JSON.parse(result.body) as ErrorResponse;
    expect(body.error).toBe('UNAUTHORIZED');
  });

  it('returns 401 when the API key is wrong', async () => {
    const result = await handler(buildEvent('/v0/waits/disneyland', 'wrong-key'));
    expect(result.statusCode).toBe(401);
  });

  it('proceeds when the API key matches the env var', async () => {
    const result = await handler(buildEvent('/v0/waits/disneyland'));
    expect(result.statusCode).toBe(200);
  });

  it('refuses every request when the API_KEY env var is unset', async () => {
    delete process.env.API_KEY;
    const result = await handler(buildEvent('/v0/waits/disneyland'));
    expect(result.statusCode).toBe(401);
  });
});

// ----- Routing -----

describe('handler — routing', () => {
  it('returns 404 for unknown paths', async () => {
    const result = await handler(buildEvent('/v0/waits/walt-disney-world'));
    expect(result.statusCode).toBe(404);
  });
});

// ----- Per-park endpoint -----

describe('handler — per-park endpoint', () => {
  it('returns the per-park shape with rides filtered and lands resolved from the static map', async () => {
    const result = await handler(buildEvent('/v0/waits/disneyland'));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body) as ParkData;
    expect(body.park).toBe('Disneyland');
    expect(body.lastUpdated).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    // SHOW is filtered out, leaving 2 rides
    expect(body.rides).toHaveLength(2);

    const space = body.rides.find(r => r.name === 'Hyperspace Mountain');
    expect(space).toMatchObject({
      land: 'Tomorrowland',
      status: 'OPERATING',
      currentWait: 55,
    });

    const peterPan = body.rides.find(r => r.name === "Peter Pan's Flight");
    expect(peterPan).toMatchObject({
      land: 'Fantasyland',
      status: 'CLOSED',
      currentWait: null,
    });
  });

  it('returns 502 with UPSTREAM_UNAVAILABLE when upstream fails and there is no cache', async () => {
    const realUpstreamError = jest.requireActual('./themeparksClient').UpstreamError;
    mockedClient.fetchLiveData.mockRejectedValue(new realUpstreamError(502, 'upstream down'));

    const result = await handler(buildEvent('/v0/waits/disneyland'));
    expect(result.statusCode).toBe(502);

    const body = JSON.parse(result.body) as ErrorResponse;
    expect(body.error).toBe('UPSTREAM_UNAVAILABLE');
  });
});

// ----- Combined endpoint -----

describe('handler — combined endpoint', () => {
  it('returns 200 with both parks in fixed order when both succeed', async () => {
    const result = await handler(buildEvent('/v0/waits'));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body) as CombinedResponse;
    expect(body.parks).toHaveLength(2);
    expect(body.parks[0].park).toBe('Disneyland');
    expect(body.parks[1].park).toBe('Disney California Adventure');
  });

  it('returns 200 with partial failure — DCA succeeds, Disneyland fails', async () => {
    const realUpstreamError = jest.requireActual('./themeparksClient').UpstreamError;
    mockedClient.fetchLiveData.mockImplementation(async slug => {
      if (slug === 'disneyland') throw new realUpstreamError(502, 'DL down');
      return dcaLive;
    });

    const result = await handler(buildEvent('/v0/waits'));
    expect(result.statusCode).toBe(200);

    const body = JSON.parse(result.body) as CombinedResponse;
    expect(body.parks).toHaveLength(2);

    const dl = body.parks[0] as ParkError;
    expect(dl.park).toBe('Disneyland');
    expect(dl.lastUpdated).toBeNull();
    expect(dl.rides).toEqual([]);
    expect(dl.error).toBe('UPSTREAM_UNAVAILABLE');

    const dca = body.parks[1] as ParkData;
    expect(dca.park).toBe('Disney California Adventure');
    expect(dca.rides).toHaveLength(1);
    expect(dca.rides[0].land).toBe('Cars Land');
  });

  it('returns 502 with the structured error shape when both parks fail with no cache', async () => {
    const realUpstreamError = jest.requireActual('./themeparksClient').UpstreamError;
    mockedClient.fetchLiveData.mockRejectedValue(new realUpstreamError(502, 'all down'));

    const result = await handler(buildEvent('/v0/waits'));
    expect(result.statusCode).toBe(502);

    const body = JSON.parse(result.body) as ErrorResponse;
    expect(body.error).toBe('UPSTREAM_UNAVAILABLE');
    expect(body.lastUpdated).toBeNull();
  });
});

// ----- Caching -----

describe('handler — caching', () => {
  it('does not re-hit upstream when a per-park request is repeated within TTL', async () => {
    await handler(buildEvent('/v0/waits/disneyland'));
    await handler(buildEvent('/v0/waits/disneyland'));

    expect(mockedClient.fetchLiveData).toHaveBeenCalledTimes(1);
  });

  it('re-hits upstream after the TTL expires', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date('2026-05-15T20:00:00Z'));

    await handler(buildEvent('/v0/waits/disneyland'));
    expect(mockedClient.fetchLiveData).toHaveBeenCalledTimes(1);

    // Advance past the 150s TTL
    jest.setSystemTime(new Date('2026-05-15T20:02:31Z'));

    await handler(buildEvent('/v0/waits/disneyland'));
    expect(mockedClient.fetchLiveData).toHaveBeenCalledTimes(2);

    jest.useRealTimers();
  });

  it('keeps independent per-park caches — combined then per-park does not re-fetch', async () => {
    await handler(buildEvent('/v0/waits'));
    expect(mockedClient.fetchLiveData).toHaveBeenCalledTimes(2);

    await handler(buildEvent('/v0/waits/disneyland'));
    expect(mockedClient.fetchLiveData).toHaveBeenCalledTimes(2);

    await handler(buildEvent('/v0/waits/california-adventure'));
    expect(mockedClient.fetchLiveData).toHaveBeenCalledTimes(2);
  });
});
