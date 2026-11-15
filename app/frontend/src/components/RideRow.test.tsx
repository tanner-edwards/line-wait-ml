import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { RideRow } from './RideRow';
import { Ride } from '../types';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const layout = (width: number) => ({ nativeEvent: { layout: { width, height: 20, x: 0, y: 0 } } });

const ride = {
  id: 'r1', name: 'Indiana Jones Adventure', land: 'Adventureland', status: 'OPERATING', currentWait: 70,
  historicalAverage: null, rideStats: null, prediction: null, recentHistory: null,
  lat: 33.8121, lng: -117.919,
  verdict: { verdict: 'skip' },
} as unknown as Ride;

// Fires onLayout for the row, badge, measured full label and walk time.
function measure(rowW: number, badgeW: number, labelW: number, walkW: number, shortW = 70) {
  const hidden = { includeHiddenElements: true };
  fireEvent(screen.getByTestId('ride-meta-r1'), 'layout', layout(rowW));
  fireEvent(screen.getByTestId('ride-meta-badge-r1'), 'layout', layout(badgeW));
  fireEvent(screen.getByTestId('ride-meta-measure-r1', hidden), 'layout', layout(labelW));
  fireEvent(screen.getByTestId('ride-meta-measure-short-r1', hidden), 'layout', layout(shortW));
  fireEvent(screen.getByTestId('ride-meta-walk-r1'), 'layout', layout(walkW));
}

describe('RideRow wait label', () => {
  const renderRow = () =>
    render(<RideRow ride={ride} walkOrigin={{ lat: 33.8121, lng: -117.919 }} isWatching={false} onPress={jest.fn()} />);

  it('keeps "min wait" when everything fits', () => {
    renderRow();
    measure(250, 100, 90, 36); // 100 + 90 + 36 + 2×12 = 250
    expect(screen.getByTestId('ride-wait-r1')).toHaveTextContent('70 min wait');
  });

  it('drops "wait" instead of ellipsizing when tight', () => {
    renderRow();
    measure(249, 100, 90, 36);
    expect(screen.getByTestId('ride-wait-r1')).toHaveTextContent('70 min');
  });

  it('falls back to "70m" when "70 min" still will not fit', () => {
    renderRow();
    measure(229, 100, 90, 36, 70); // 100 + 70 + 36 + 24 = 230
    expect(screen.getByTestId('ride-wait-r1')).toHaveTextContent('70m');
  });
});
