import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MetaRow } from './RecommendationCard';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const layout = (width: number) => ({ nativeEvent: { layout: { width, height: 20, x: 0, y: 0 } } });

// Fires onLayout for the row, badge, measured label copy and pill.
function measure(rowW: number, badgeW: number, labelW: number, pillW: number, shortW = 60) {
  const row = screen.getByTestId('rec-meta-r1');
  fireEvent(row, 'layout', layout(rowW));
  fireEvent(screen.getByTestId('rec-meta-badge-r1'), 'layout', layout(badgeW));
  fireEvent(screen.getByTestId('rec-meta-measure-r1', { includeHiddenElements: true }), 'layout', layout(labelW));
  fireEvent(screen.getByTestId('rec-meta-pill-r1'), 'layout', layout(pillW));
  const short = screen.queryByTestId('rec-meta-measure-short-r1', { includeHiddenElements: true });
  if (short) fireEvent(short, 'layout', layout(shortW));
}

describe('MetaRow wait label', () => {
  const props = { rideId: 'r1', badge: 'go' as const, waitLabel: '120 min wait', walkOn: false, walkMinutes: 4 };

  it('keeps "min wait" when everything fits', () => {
    render(<MetaRow {...props} />);
    measure(264, 110, 80, 54); // 110 + 80 + 54 + 2×10 = 264
    expect(screen.getByTestId('rec-meta-wait-r1')).toHaveTextContent('120 min wait');
  });

  it('drops "wait" when the full label would not fit', () => {
    render(<MetaRow {...props} />);
    measure(263, 110, 80, 54);
    expect(screen.getByTestId('rec-meta-wait-r1')).toHaveTextContent('120 min');
  });

  it('falls back to "120m" when "120 min" still will not fit', () => {
    render(<MetaRow {...props} />);
    measure(233, 110, 80, 54, 50); // 110 + 50 + 54 + 20 = 234
    expect(screen.getByTestId('rec-meta-wait-r1')).toHaveTextContent('120m');
  });

  it('leaves Walk On alone even when tight', () => {
    render(<MetaRow {...props} waitLabel="Walk On" walkOn />);
    measure(100, 110, 60, 54);
    expect(screen.getByTestId('rec-meta-wait-r1')).toHaveTextContent('Walk On');
  });
});
