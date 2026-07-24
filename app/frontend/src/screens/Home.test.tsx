import React from 'react';
import { RefreshControl } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Home } from './Home';
import * as api from '../api';
import { CombinedResponse, HistoricalAverage, Ride } from '../types';
import { RideProvider } from '../context/RideContext';
import { LocationProvider } from '../context/LocationContext';
import { DailyContextProvider } from '../context/DailyContextContext';
import { PersonaProvider } from '../context/PersonaContext';
import { DeviceProvider } from '../context/DeviceContext';
import { NotificationDetailProvider } from '../context/NotificationDetailContext';

// AsyncStorage's native module is unavailable in jest; use the library's
// official in-memory mock per its testing docs.
jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

jest.mock('../api', () => {
  const actual = jest.requireActual<typeof import('../api')>('../api');
  return {
    ...actual,
    fetchWaits: jest.fn(),
  };
});

const mockFetchWaits = api.fetchWaits as jest.MockedFunction<typeof api.fetchWaits>;

// As of Slice D1, Home reads from RideContext instead of fetching directly.
// Wrap every render in <RideProvider> so the provider's effect fires the
// (mocked) fetchWaits call and pushes data down to Home.
function renderHome() {
  return render(
    <PersonaProvider>
      <DailyContextProvider>
        <DeviceProvider>
          <LocationProvider>
            <RideProvider>
              <NotificationDetailProvider>
                <Home />
              </NotificationDetailProvider>
            </RideProvider>
          </LocationProvider>
        </DeviceProvider>
      </DailyContextProvider>
    </PersonaProvider>
  );
}

// Helper: build a HistoricalAverage with sane defaults. Override individual
// buckets via partials for clarity in tests.
function makeHistoricalAverage(
  bucket0: { wait: number | null; sampleCount: number },
  bucket4: { wait: number | null; sampleCount: number },
  bucket1: { wait: number | null; sampleCount: number } = { wait: 30, sampleCount: 100 },
  bucket2: { wait: number | null; sampleCount: number } = { wait: 30, sampleCount: 100 },
  bucket3: { wait: number | null; sampleCount: number } = { wait: 30, sampleCount: 100 }
): HistoricalAverage {
  return {
    dayType: 'weekday',
    buckets: [
      { offsetMinutes: 0,   timeSlot: '10:00-10:30', wait: bucket0.wait, sampleCount: bucket0.sampleCount },
      { offsetMinutes: 30,  timeSlot: '10:30-11:00', wait: bucket1.wait, sampleCount: bucket1.sampleCount },
      { offsetMinutes: 60,  timeSlot: '11:00-11:30', wait: bucket2.wait, sampleCount: bucket2.sampleCount },
      { offsetMinutes: 90,  timeSlot: '11:30-12:00', wait: bucket3.wait, sampleCount: bucket3.sampleCount },
      { offsetMinutes: 120, timeSlot: '12:00-12:30', wait: bucket4.wait, sampleCount: bucket4.sampleCount },
      { offsetMinutes: 150, timeSlot: '12:30-13:00', wait: 30, sampleCount: 100 },
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
          rideStats: null,
          prediction: null,
          recentHistory: null,
          lat: null,
          lng: null,
        },
        {
          id: 'pp',
          name: "Peter Pan's Flight",
          land: 'Fantasyland',
          status: 'CLOSED',
          currentWait: null,
          historicalAverage: null,
          rideStats: null,
          prediction: null,
          recentHistory: null,
          lat: null,
          lng: null,
        },
        {
          id: 'sw',
          name: 'Snow White',
          land: 'Fantasyland',
          status: 'OPERATING',
          currentWait: null,
          historicalAverage: null,
          rideStats: null,
          prediction: null,
          recentHistory: null,
          lat: null,
          lng: null,
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
          rideStats: null,
          prediction: null,
          recentHistory: null,
          lat: null,
          lng: null,
        },
      ],
    },
  ],
};

// Helper: build a single-ride response for v1 indicator tests.
// Test fixtures only spell out the fields each test cares about; pad missing
// ones with null so they satisfy the `Ride` type without each call site
// repeating the same defaults.
function singleRideResponse(partial: Partial<Ride> & Pick<Ride, 'id' | 'name' | 'land' | 'status'>): CombinedResponse {
  const ride: Ride = {
    currentWait: null,
    historicalAverage: null,
    rideStats: null,
    prediction: null,
    recentHistory: null,
    lat: null,
    lng: null,
    ...partial,
  };
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
  it('renders park headers and rides with waits (default: opportunity sort)', async () => {
    mockFetchWaits.mockResolvedValue(happyResponse);

    renderHome();

    // After load, the loaded view appears
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    // Park headers still render in opportunity-sort mode; land headers do
    // not (flattenSorted emits flat rides under each park header).
    expect(screen.getByTestId('park-Disneyland')).toBeTruthy();
    expect(screen.getByTestId('park-Disney California Adventure')).toBeTruthy();
    expect(screen.queryByTestId('land-Fantasyland')).toBeNull();
    expect(screen.queryByTestId('land-Tomorrowland')).toBeNull();
    expect(screen.queryByTestId('land-Cars Land')).toBeNull();

    // Ride rows render with the right labels
    expect(screen.getByText('Hyperspace Mountain')).toBeTruthy();
    expect(screen.getByText('55')).toBeTruthy();

    // Missing wait renders as "—"
    expect(screen.getByText('Snow White')).toBeTruthy();
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);

    // Closed ride renders "Closed"
    expect(screen.getByText("Peter Pan's Flight")).toBeTruthy();
    expect(screen.getByText('Closed')).toBeTruthy();
  });

  it('shows the older of the two parks\' lastUpdated as HH:MM', async () => {
    mockFetchWaits.mockResolvedValue(happyResponse);
    renderHome();

    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    // Just assert format — exact hours depend on test TZ.
    const header = screen.getByTestId('last-update');
    expect(header).toHaveTextContent(/^Last update: \d{1,2}:\d{2} (AM|PM)$/);
  });
});

describe('Home — first-load failure', () => {
  it('renders the error banner and the empty state when the fetch throws and there is no prior data', async () => {
    mockFetchWaits.mockRejectedValue(new api.ApiError(502, 'upstream down'));

    renderHome();

    await waitFor(() => expect(screen.queryByTestId('error-banner')).toBeTruthy());
    expect(screen.queryByTestId('empty-state')).toBeTruthy();
  });
});

describe('Home — pull-to-refresh', () => {
  it('re-fetches data when the user pulls to refresh', async () => {
    mockFetchWaits.mockResolvedValue(happyResponse);
    const { UNSAFE_getByType } = renderHome();

    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());
    expect(mockFetchWaits).toHaveBeenCalledTimes(1);

    // Simulate the RefreshControl firing its onRefresh callback.
    fireEvent(UNSAFE_getByType(RefreshControl), 'refresh');

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

    renderHome();

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
    renderHome();
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
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByText('40')).toBeTruthy();
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
    renderHome();
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
    renderHome();
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
    renderHome();
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
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('below-normal-badge')).toBeTruthy();
    expect(screen.getByText('Below normal')).toBeTruthy();
  });

  it('shows "Running high" badge when currentWait > bucket[0] * 1.25', async () => {
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
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('above-normal-badge')).toBeTruthy();
    expect(screen.getByText('Running high')).toBeTruthy();
  });

  it('low-confidence (bucket[0].sampleCount=0): badge suppressed, arrow uses low-conf styling', async () => {
    // Confidence threshold is currently 1 (lowered from 20 while wait_times
    // is still accumulating history — see Home.tsx + BelowNormalBadge.tsx
    // comments). Only sampleCount=0 triggers suppression.
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'space',
        name: 'Hyperspace Mountain',
        land: 'Tomorrowland',
        currentWait: 10,
        historicalAverage: makeHistoricalAverage(
          { wait: 50, sampleCount: 0 },
          { wait: 25, sampleCount: 0 }
        ),
        status: 'OPERATING',
        prediction: null,
      })
    );
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.queryByTestId('below-normal-badge')).toBeNull();
    expect(screen.queryByTestId('above-normal-badge')).toBeNull();
    // Arrow still renders with low-confidence variant. TrendArrow is anchored
    // to currentWait=10; bucket4.wait=25 is higher → up-low-conf.
    expect(screen.getByTestId('trend-arrow-up-low-conf')).toBeTruthy();
  });

  it('bucket[0].wait === 0: TrendArrow uses currentWait as anchor (still renders), below-normal badge suppressed', async () => {
    // TrendArrow is now anchored to currentWait=25, not bucket0.wait=0.
    // currentWait=25 vs bucket4.wait=25 → stable arrow renders.
    // BelowNormalBadge still guards against bucket0.wait=0 → no badge.
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
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('trend-arrow-stable')).toBeTruthy();
    expect(screen.queryByTestId('below-normal-badge')).toBeNull();
    expect(screen.queryByTestId('above-normal-badge')).toBeNull();
  });
});

describe('Home — walk-on indicator', () => {
  it('shows 🚶 and hides recommendation badge when currentWait is 5 (default floor)', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'carousel',
        name: 'King Arthur Carrousel',
        land: 'Fantasyland',
        status: 'OPERATING',
        currentWait: 5,
        historicalAverage: null,
        rideStats: null,
        prediction: null,
      })
    );
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('badge-walk-on')).toBeTruthy();
    expect(screen.queryByTestId('badge-go')).toBeNull();
    expect(screen.queryByTestId('badge-skip')).toBeNull();
    expect(screen.queryByTestId('badge-star')).toBeNull();
  });

  it('does NOT show 🚶 when currentWait is 6 (above default floor)', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'carousel',
        name: 'King Arthur Carrousel',
        land: 'Fantasyland',
        status: 'OPERATING',
        currentWait: 6,
        historicalAverage: null,
        rideStats: null,
        prediction: null,
      })
    );
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.queryByTestId('badge-walk-on')).toBeNull();
  });

  it('shows 🚶 for Haunted Mansion at 13 min (custom floor)', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'ff52cb64-c1d5-4feb-9d43-5dbd429bac81',
        name: 'Haunted Mansion',
        land: 'New Orleans Square',
        status: 'OPERATING',
        currentWait: 13,
        historicalAverage: null,
        rideStats: null,
        prediction: null,
      })
    );
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('badge-walk-on')).toBeTruthy();
  });

  it('does NOT show 🚶 for Haunted Mansion at 14 min (above custom floor)', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'ff52cb64-c1d5-4feb-9d43-5dbd429bac81',
        name: 'Haunted Mansion',
        land: 'New Orleans Square',
        status: 'OPERATING',
        currentWait: 14,
        historicalAverage: null,
        rideStats: null,
        prediction: null,
      })
    );
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.queryByTestId('badge-walk-on')).toBeNull();
  });

  it('does NOT show 🚶 for a closed ride', async () => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'carousel',
        name: 'King Arthur Carrousel',
        land: 'Fantasyland',
        status: 'CLOSED',
        currentWait: null,
        historicalAverage: null,
        rideStats: null,
        prediction: null,
      })
    );
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.queryByTestId('badge-walk-on')).toBeNull();
  });
});
