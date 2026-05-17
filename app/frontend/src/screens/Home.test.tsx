import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import { Home } from './Home';
import * as api from '../api';
import { CombinedResponse } from '../types';

jest.mock('../api', () => {
  const actual = jest.requireActual<typeof import('../api')>('../api');
  return {
    ...actual,
    fetchWaits: jest.fn(),
  };
});

const mockFetchWaits = api.fetchWaits as jest.MockedFunction<typeof api.fetchWaits>;

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
        },
        {
          id: 'pp',
          name: "Peter Pan's Flight",
          land: 'Fantasyland',
          status: 'CLOSED',
          currentWait: null,
        },
        {
          id: 'sw',
          name: 'Snow White',
          land: 'Fantasyland',
          status: 'OPERATING',
          currentWait: null,
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
        },
      ],
    },
  ],
};

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
