import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Home } from './Home';
import * as api from '../api';
import { CombinedResponse, HistoricalAverage, Ride } from '../types';

jest.mock('../api', () => {
  const actual = jest.requireActual<typeof import('../api')>('../api');
  return {
    ...actual,
    fetchWaits: jest.fn(),
  };
});

const mockFetchWaits = api.fetchWaits as jest.MockedFunction<typeof api.fetchWaits>;

// Helper: build a HistoricalAverage with sane defaults. Override individual
// buckets via partials for clarity in tests.
function makeHistoricalAverage(
  bucket0: { wait: number | null; sampleCount: number },
  bucket2: { wait: number | null; sampleCount: number },
  bucket1: { wait: number | null; sampleCount: number } = { wait: 30, sampleCount: 100 }
): HistoricalAverage {
  return {
    dayType: 'weekday',
    buckets: [
      { offsetMinutes: 0, timeSlot: '10:00-10:30', wait: bucket0.wait, sampleCount: bucket0.sampleCount },
      { offsetMinutes: 30, timeSlot: '10:30-11:00', wait: bucket1.wait, sampleCount: bucket1.sampleCount },
      { offsetMinutes: 60, timeSlot: '11:00-11:30', wait: bucket2.wait, sampleCount: bucket2.sampleCount },
    ],
  };
}

const happyResponse: CombinedResponse = {
  parks: [
    {
      park: 'Disneyland',
      lastUpdated: '2026-05-15T20:00:00Z',
      rides: [
        {
          id: 'space',
          name: 'Hyperspace Mountain',
          land: 'Tomorrowland',
          status: 'OPERATING',
          currentWait: 55,
          historicalAverage: null,
          prediction: null,
        },
        {
          id: 'pp',
          name: "Peter Pan's Flight",
          land: 'Fantasyland',
          status: 'CLOSED',
          currentWait: null,
          historicalAverage: null,
          prediction: null,
        },
        {
          id: 'sw',
          name: 'Snow White',
          land: 'Fantasyland',
          status: 'OPERATING',
          currentWait: null,
          historicalAverage: null,
          prediction: null,
        },
      ],
    },
    {
      park: 'Disney California Adventure',
      lastUpdated: '2026-05-15T20:01:00Z',
      rides: [
        {
          id: 'rsr',
          name: 'Radiator Springs Racers',
          land: 'Cars Land',
          status: 'OPERATING',
          currentWait: 80,
          historicalAverage: null,
          prediction: null,
        },
      ],
    },
  ],
};

// Helper: build a single-ride response for v1 indicator tests.
function singleRideResponse(ride: Ride): CombinedResponse {
  return {
    parks: [
      {
        park: 'Disneyland',
        lastUpdated: '2026-05-15T20:00:00Z',
        rides: [ride],
      },
    ],
  };
}

beforeEach(() => {
  mockFetchWaits.mockReset();
});

describe('Home — initial successful load', () => {
  it('renders both park headers in order, lands sorted, rides with waits', async () => {
    mockFetchWaits.mockResolvedValue(happyResponse);

    render(<Home />);

    // After load, the loaded view appears
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('park-Disneyland')).toBeTruthy();
    expect(screen.getByTestId('park-Disney California Adventure')).toBeTruthy();

    // Land headers exist
    expect(screen.getByTestId('land-Fantasyland')).toBeTruthy();
    expect(screen.getByTestId('land-Tomorrowland')).toBeTruthy();
    expect(screen.getByTestId('land-Cars Land')).toBeTruthy();

    // Ride rows render with the right labels
    expect(screen.getByText('Hyperspace Mountain')).toBeTruthy();
    expect(screen.getByText('55 min')).toBeTruthy();

    // Missing wait renders as "—"
    expect(screen.getByText('Snow White')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    // Closed ride renders "Closed"
    expect(screen.getByText("Peter Pan's Flight")).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
  });

  it('shows the older of the two parks\' lastUpdated as HH:MM', async () => {
    mockFetchWaits.mockResolvedValue(happyResponse);
    render(<Home />);

    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    // Just assert format — exact hours depend on test TZ.
    const header = screen.getByTestId('last-update');
    expect(header).toHaveTextContent(/^Last update: \d{2}:\d{2}$/);
  });
});

describe('Home — first-load failure', () => {
  it('renders the error banner and the empty state when the fetch throws and there is no prior data', async () => {
    mockFetchWaits.mockRejectedValue(new api.ApiError(502, 'upstream down'));

    render(<Home />);

    await waitFor(() => expect(screen.queryByTestId('error-banner')).toBeTruthy());
    expect(screen.queryByTestId('empty-state')).toBeTruthy();
  });
});

describe('Home — refresh button', () => {
  it('re-fetches data when the Refresh button is pressed', async () => {
    mockFetchWaits.mockResolvedValue(happyResponse);
    render(<Home />);

    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());
    expect(mockFetchWaits).toHaveBeenCalledTimes(1);

    fireEvent.press(screen.getByTestId('refresh-button'));

    await waitFor(() => expect(mockFetchWaits).toHaveBeenCalledTimes(2));
  });
});

describe('Home — partial failure', () => {
  it('renders the banner naming the failed park and still renders the successful park\'s rides', async () => {
    mockFetchWaits.mockResolvedValue({
      parks: [
        happyResponse.parks[0], // DL succeeds
        {
          park: 'Disney California Adventure',
          lastUpdated: null,
          rides: [],
          error: 'UPSTREAM_UNAVAILABLE',
        },
      ],
    } as CombinedResponse);

    render(<Home />);

    await waitFor(() => expect(screen.queryByTestId('error-banner')).toBeTruthy());

    const banner = screen.getByTestId('error-banner');
    expect(banner).toHaveTextContent(/Disney California Adventure/);

    // DL rides still render
    expect(screen.getByText('Hyperspace Mountain')).toBeTruthy();
    // DCA header still appears, marked errored
    expect(screen.getByTestId('park-Disney California Adventure')).toBeTruthy();
  });
});

describe('Home — v1 historical-context indicators', () => {
  it('closed ride: no trend arrow or normal-band badge (v0 layout exactly)', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'pp',
        name: "Peter Pan's Flight",
        land: 'Fantasyland',
        status: 'CLOSED',
        currentWait: null,
        // historicalAverage stays null for closed rides per spec
        historicalAverage: null,
        prediction: null,
      })
    );
    render(<Home />);
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByText('Closed')).toBeTruthy();
    expect(screen.queryByTestId('trend-arrow-down')).toBeNull();
    expect(screen.queryByTestId('trend-arrow-up')).toBeNull();
    expect(screen.queryByTestId('trend-arrow-stable')).toBeNull();
    expect(screen.queryByTestId('below-normal-badge')).toBeNull();
    expect(screen.queryByTestId('above-normal-badge')).toBeNull();
  });

  it('operating ride with historicalAverage:null: no indicators (v0 layout exactly)', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'new-ride',
        name: 'Brand New Attraction',
        land: 'Fantasyland',
        status: 'OPERATING',
        currentWait: 40,
        historicalAverage: null,
        prediction: null,
      })
    );
    render(<Home />);
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByText('40 min')).toBeTruthy();
    expect(screen.queryByTestId('trend-arrow-down')).toBeNull();
    expect(screen.queryByTestId('trend-arrow-up')).toBeNull();
    expect(screen.queryByTestId('trend-arrow-stable')).toBeNull();
    expect(screen.queryByTestId('below-normal-badge')).toBeNull();
    expect(screen.queryByTestId('above-normal-badge')).toBeNull();
  });

  it('shows green ↓ when bucket[2] < bucket[0] * 0.9', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'space',
        name: 'Hyperspace Mountain',
        land: 'Tomorrowland',
        status: 'OPERATING',
        currentWait: 50,
        historicalAverage: makeHistoricalAverage(
          { wait: 50, sampleCount: 100 },
          { wait: 25, sampleCount: 100 }
        ),
        prediction: null,
      })
    );
    render(<Home />);
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('trend-arrow-down')).toBeTruthy();
  });

  it('shows red ↑ when bucket[2] > bucket[0] * 1.1', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'space',
        name: 'Hyperspace Mountain',
        land: 'Tomorrowland',
        status: 'OPERATING',
        currentWait: 30,
        historicalAverage: makeHistoricalAverage(
          { wait: 30, sampleCount: 100 },
          { wait: 60, sampleCount: 100 }
        ),
        prediction: null,
      })
    );
    render(<Home />);
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('trend-arrow-up')).toBeTruthy();
  });

  it('shows gray → when next-hour averages are within ±10%', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'space',
        name: 'Hyperspace Mountain',
        land: 'Tomorrowland',
        status: 'OPERATING',
        currentWait: 30,
        historicalAverage: makeHistoricalAverage(
          { wait: 30, sampleCount: 100 },
          { wait: 31, sampleCount: 100 }
        ),
        prediction: null,
      })
    );
    render(<Home />);
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('trend-arrow-stable')).toBeTruthy();
  });

  it('shows "Below normal" badge when currentWait < bucket[0] * 0.75', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'space',
        name: 'Hyperspace Mountain',
        land: 'Tomorrowland',
        status: 'OPERATING',
        currentWait: 10,
        historicalAverage: makeHistoricalAverage(
          { wait: 40, sampleCount: 100 },
          { wait: 40, sampleCount: 100 }
        ),
        prediction: null,
      })
    );
    render(<Home />);
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('below-normal-badge')).toBeTruthy();
    expect(screen.getByText('Below normal')).toBeTruthy();
  });

  it('shows "Above normal" badge when currentWait > bucket[0] * 1.25', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'space',
        name: 'Hyperspace Mountain',
        land: 'Tomorrowland',
        status: 'OPERATING',
        currentWait: 80,
        historicalAverage: makeHistoricalAverage(
          { wait: 40, sampleCount: 100 },
          { wait: 40, sampleCount: 100 }
        ),
        prediction: null,
      })
    );
    render(<Home />);
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('above-normal-badge')).toBeTruthy();
    expect(screen.getByText('Above normal')).toBeTruthy();
  });

  it('low-confidence (bucket[0].sampleCount < 20): badge suppressed, arrow uses low-conf styling', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'space',
        name: 'Hyperspace Mountain',
        land: 'Tomorrowland',
        // Would be "Below normal" on confident data — must be suppressed here.
        currentWait: 10,
        historicalAverage: makeHistoricalAverage(
          { wait: 50, sampleCount: 5 }, // thin data
          { wait: 25, sampleCount: 5 } // still down-trend
        ),
        status: 'OPERATING',
        prediction: null,
      })
    );
    render(<Home />);
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    // Badge must NOT render despite the >25% gap — sample count below threshold.
    expect(screen.queryByTestId('below-normal-badge')).toBeNull();
    expect(screen.queryByTestId('above-normal-badge')).toBeNull();
    // Arrow still renders, but with the low-confidence variant testID.
    expect(screen.getByTestId('trend-arrow-down-low-conf')).toBeTruthy();
  });

  it('bucket[0].wait === 0: neither indicator renders (zero-division guard)', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'space',
        name: 'Hyperspace Mountain',
        land: 'Tomorrowland',
        status: 'OPERATING',
        currentWait: 25,
        historicalAverage: makeHistoricalAverage(
          { wait: 0, sampleCount: 100 },
          { wait: 25, sampleCount: 100 }
        ),
        prediction: null,
      })
    );
    render(<Home />);
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.queryByTestId('trend-arrow-down')).toBeNull();
    expect(screen.queryByTestId('trend-arrow-up')).toBeNull();
    expect(screen.queryByTestId('trend-arrow-stable')).toBeNull();
    expect(screen.queryByTestId('below-normal-badge')).toBeNull();
    expect(screen.queryByTestId('above-normal-badge')).toBeNull();
  });
});
