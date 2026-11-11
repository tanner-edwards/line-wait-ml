import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MoreToConsider } from './MoreToConsider';
import { Recommendation, RecommendationsResponse, Ride } from '../types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

// Screen reads everything through hooks — mock each so the test controls the
// shared rec list directly.
const mockLoadMore = jest.fn(() => Promise.resolve());
const mockRecsState: {
  recs: RecommendationsResponse | null;
  firstBatchCount: number;
  loadingMore: boolean;
  loadMoreError: string | null;
} = { recs: null, firstBatchCount: 0, loadingMore: false, loadMoreError: null };

jest.mock('../context/RecsContext', () => ({
  useRecs: () => ({ ...mockRecsState, loadMore: mockLoadMore, setInitialRecs: jest.fn() }),
}));
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({ goBack: jest.fn() }),
}));
const mockRides = new Map<string, Ride>();
jest.mock('../context/RideContext', () => ({ useRides: () => ({ ridesById: mockRides }) }));
const mockRetired: string[] = [];
jest.mock('../context/DeviceContext', () => ({
  useDevice: () => ({ retiredRideIds: mockRetired, retireRide: jest.fn(), unretireRide: jest.fn() }),
}));
jest.mock('../context/DebugModeContext', () => ({ useDebugMode: () => ({ debugMode: false }) }));
jest.mock('../context/NotificationDetailContext', () => ({
  useNotificationDetail: () => ({ openDetail: jest.fn() }),
}));

function rec(id: string): Recommendation {
  return { rideId: id, oneLiner: `${id} line`, restrictionNote: null, walkMinutes: 3, walkYards: null, arrivalWait: 20 };
}
function ride(id: string): Ride {
  return {
    id, name: `Ride ${id}`, land: 'Fantasyland', status: 'OPERATING', currentWait: 20,
    historicalAverage: null, rideStats: null, prediction: null, recentHistory: null, lat: null, lng: null,
  };
}
function setRecs(ids: string[], firstBatchCount: number, hasMore: boolean) {
  mockRecsState.recs = {
    currentRide: { id: 'x', name: 'X', park: 'disneyland' } as RecommendationsResponse['currentRide'],
    park: 'disneyland',
    lastUpdated: '2026-11-10T20:00:00Z',
    degraded: false,
    recommendations: ids.map(rec),
    hasMore,
  };
  mockRecsState.firstBatchCount = firstBatchCount;
  ids.forEach(id => mockRides.set(id, ride(id)));
}

beforeEach(() => {
  mockLoadMore.mockClear();
  mockRides.clear();
  mockRetired.length = 0;
  Object.assign(mockRecsState, { recs: null, firstBatchCount: 0, loadingMore: false, loadMoreError: null });
});

describe('MoreToConsider', () => {
  it('fetches the next batch on open when only the first batch is loaded', () => {
    setRecs(['a', 'b', 'c', 'd', 'e'], 5, true);
    render(<MoreToConsider />);
    expect(mockLoadMore).toHaveBeenCalledTimes(1);
  });

  it('lists only recs past the first batch, and Show More loads another', () => {
    setRecs(['a', 'b', 'c', 'd', 'e', 'f', 'g'], 5, true);
    render(<MoreToConsider />);

    expect(mockLoadMore).not.toHaveBeenCalled();
    expect(screen.queryByText('Ride a')).toBeNull();
    expect(screen.queryByText('Ride e')).toBeNull();
    expect(screen.getByText('Ride f')).toBeTruthy();
    expect(screen.getByText('Ride g')).toBeTruthy();

    fireEvent.press(screen.getByTestId('more-show-more'));
    expect(mockLoadMore).toHaveBeenCalledTimes(1);
  });

  it('hides ridden recs and shows the end state when nothing more exists', () => {
    setRecs(['a', 'b', 'c', 'd', 'e', 'f'], 5, false);
    mockRetired.push('f');
    render(<MoreToConsider />);

    expect(screen.queryByText('Ride f')).toBeNull();
    expect(screen.getByTestId('more-empty')).toBeTruthy();
    expect(screen.queryByTestId('more-show-more')).toBeNull();
  });
});
