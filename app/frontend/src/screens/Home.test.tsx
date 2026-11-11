import React from 'react';
import { RefreshControl } from 'react-native';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Home } from './Home';
import * as api from '../api';
import { CombinedResponse, HistoricalAverage, Ride, Prediction } from '../types';
import { RideProvider } from '../context/RideContext';
import { LocationProvider } from '../context/LocationContext';
import { DailyContextProvider } from '../context/DailyContextContext';
import { PersonaProvider } from '../context/PersonaContext';
import { DeviceProvider } from '../context/DeviceContext';
import { NotificationDetailProvider } from '../context/NotificationDetailContext';
import { DebugModeProvider } from '../context/DebugModeContext';

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

// Discover defaults to the Nearby chip, which needs a fix. Fixture rides have
// no coords, so every walk time ties and Nearby falls through to opportunity
// order — the same order these tests were written against.
const mockLocation: { coords: { lat: number; lng: number } | null; status: string } = {
  coords: { lat: 33.8121, lng: -117.919 },
  status: 'ready',
};
jest.mock('../context/LocationContext', () => ({
  LocationProvider: ({ children }: { children: React.ReactNode }) => children,
  useLocation: () => ({
    ...mockLocation,
    requestPermission: jest.fn(),
    retry: jest.fn(),
    setDebugCoords: jest.fn(),
    clearDebugCoords: jest.fn(),
  }),
}));

// gorhom's BottomSheetModal needs a provider the test tree doesn't mount.
jest.mock('../components/LandPickerSheet', () => ({ LandPickerSheet: () => null }));

// As of Slice D1, Home reads from RideContext instead of fetching directly.
// Wrap every render in <RideProvider> so the provider's effect fires the
// (mocked) fetchWaits call and pushes data down to Home.
function renderHome() {
  return render(
    <PersonaProvider>
      <DailyContextProvider>
        <DeviceProvider>
          <DebugModeProvider>
            <LocationProvider>
              <RideProvider>
                <NotificationDetailProvider>
                  <Home />
                </NotificationDetailProvider>
              </RideProvider>
            </LocationProvider>
          </DebugModeProvider>
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
  mockLocation.coords = { lat: 33.8121, lng: -117.919 };
  mockLocation.status = 'ready';
});

describe('Home — initial successful load', () => {
  it('renders park headers and rides with waits (default: opportunity sort)', async () => {
    mockFetchWaits.mockResolvedValue(happyResponse);

    renderHome();

    // After load, the loaded view appears
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    // Sorted/chip views are one flat list — no park or land headers (only
    // the A–Z sort groups by park and land).
    expect(screen.queryByTestId('park-Disneyland')).toBeNull();
    expect(screen.queryByTestId('park-Disney California Adventure')).toBeNull();
    expect(screen.queryByTestId('land-Fantasyland')).toBeNull();
    expect(screen.queryByTestId('land-Tomorrowland')).toBeNull();
    expect(screen.queryByTestId('land-Cars Land')).toBeNull();

    // Ride rows render with the right labels
    expect(screen.getByText('Hyperspace Mountain')).toBeTruthy();
    expect(screen.getByText('55 min wait')).toBeTruthy();

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
    // No park headers in the default view — the banner carries the failure.
    expect(screen.queryByTestId('park-Disney California Adventure')).toBeNull();
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

    expect(screen.getByText('40 min wait')).toBeTruthy();
    expect(screen.queryByTestId('trend-arrow-down')).toBeNull();
    expect(screen.queryByTestId('trend-arrow-up')).toBeNull();
    expect(screen.queryByTestId('trend-arrow-stable')).toBeNull();
    expect(screen.queryByTestId('below-normal-badge')).toBeNull();
    expect(screen.queryByTestId('above-normal-badge')).toBeNull();
  });

  // Rows dropped the trend label in the phase-3 redesign (ride detail keeps
  // it) — a falling or rising trajectory must not show on the row.
  const predictionWithTrend = (trend: Prediction['trend']): Prediction => ({
    t10: 0, t20: 0, t30: 0, t40: 0, t50: 0, t60: 0, t90: 0, t120: 0, t150: 0,
    trend, trendDelta30: 0, confidence: 'high', updatedAt: 't',
  });

  it.each(['falling', 'rising'] as const)('shows no trend on the row when the trajectory is %s', async (trend) => {
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'space', name: 'Hyperspace Mountain', land: 'Tomorrowland',
        status: 'OPERATING', currentWait: 50, prediction: predictionWithTrend(trend),
      })
    );
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.queryByTestId('trend-arrow-down')).toBeNull();
    expect(screen.queryByTestId('trend-arrow-up')).toBeNull();
    expect(screen.queryByText('Dropping')).toBeNull();
    expect(screen.queryByText('Rising')).toBeNull();
  });

  it('the wait number is a neutral fact — below/above-normal badges are gone', async () => {
    // The old "Below normal" / "Running high" pills were removed in the
    // one-chip unification; the verdict badge is the only good/bad signal now.
    mockFetchWaits.mockResolvedValue(
      singleRideResponse({
        id: 'space', name: 'Hyperspace Mountain', land: 'Tomorrowland',
        status: 'OPERATING', currentWait: 10, prediction: null,
      })
    );
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByText('10 min wait')).toBeTruthy();
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

describe('Discover — chips', () => {
  it('Nearby without a fix shows the pre-permission prompt with a Continue button', async () => {
    mockLocation.coords = null;
    mockLocation.status = 'needs-permission';
    mockFetchWaits.mockResolvedValue(happyResponse);
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('nearby-location-permission')).toBeTruthy();
    expect(screen.getByText('Continue')).toBeTruthy();
    expect(screen.queryByText('Hyperspace Mountain')).toBeNull();
  });

  it('Nearby with location denied points to Settings', async () => {
    mockLocation.coords = null;
    mockLocation.status = 'denied';
    mockFetchWaits.mockResolvedValue(happyResponse);
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    expect(screen.getByTestId('nearby-location-denied')).toBeTruthy();
    expect(screen.getByText('Open Settings')).toBeTruthy();
  });

  it('Your List with no watched rides shows its empty state', async () => {
    mockFetchWaits.mockResolvedValue(happyResponse);
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    fireEvent.press(screen.getByTestId('chip-list'));

    expect(screen.getByTestId('list-empty-state')).toBeTruthy();
    expect(screen.queryByText('Hyperspace Mountain')).toBeNull();
  });

  it('A–Z by land is the grouped full list with park and land headers', async () => {
    mockFetchWaits.mockResolvedValue(happyResponse);
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    fireEvent.press(screen.getByTestId('sort-button'));
    fireEvent.press(screen.getByText('A–Z by land'));

    expect(screen.getByTestId('park-Disneyland')).toBeTruthy();
    expect(screen.getByTestId('land-Fantasyland')).toBeTruthy();
  });

  it('picking a sort clears the Nearby chip and restores the list', async () => {
    mockLocation.coords = null;
    mockLocation.status = 'denied';
    mockFetchWaits.mockResolvedValue(happyResponse);
    renderHome();
    await waitFor(() => expect(screen.queryByTestId('home-loaded')).toBeTruthy());

    fireEvent.press(screen.getByTestId('sort-button'));
    fireEvent.press(screen.getByText('Opportunity'));

    expect(screen.queryByTestId('nearby-location-denied')).toBeNull();
    expect(screen.getByText('Hyperspace Mountain')).toBeTruthy();
  });
});
