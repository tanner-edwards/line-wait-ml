import { fetchLiveData, UpstreamError } from './themeparksClient';

describe('themeparksClient', () => {
  const fetchMock = jest.fn();

  beforeEach(() => {
    fetchMock.mockReset();
    global.fetch = fetchMock as unknown as typeof fetch;
  });

  it('fetchLiveData hits the Disneyland live endpoint with the right UUID', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'x', name: 'Disneyland Park', liveData: [] }),
    });

    await fetchLiveData('disneyland');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.themeparks.wiki/v1/entity/7340550b-c14d-4def-80bb-acdb51d49a66/live'
    );
  });

  it('fetchLiveData hits the DCA live endpoint with the right UUID', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      json: async () => ({ id: 'x', name: 'DCA', liveData: [] }),
    });

    await fetchLiveData('california-adventure');

    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.themeparks.wiki/v1/entity/832fcd51-ea19-4e77-85c7-75d5843b127c/live'
    );
  });

  it('throws UpstreamError carrying the HTTP status when upstream returns non-2xx', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 502,
      json: async () => ({}),
    });

    await expect(fetchLiveData('disneyland')).rejects.toBeInstanceOf(UpstreamError);
    await expect(fetchLiveData('disneyland')).rejects.toMatchObject({
      statusCode: 502,
    });
  });
});
