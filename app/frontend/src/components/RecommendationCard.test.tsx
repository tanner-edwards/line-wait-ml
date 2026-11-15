import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { MetaRow } from './RecommendationCard';

jest.mock('@react-native-async-storage/async-storage', () =>
  require('@react-native-async-storage/async-storage/jest/async-storage-mock')
);

const layout = (width: number) => ({ nativeEvent: { layout: { width, height: 20, x: 0, y: 0 } } });

// Fires onLayout for the row, badge, measured label copy and pill.
function measure(rowW: number, badgeW: number, labelW: number, pillW: number) {
  const row = screen.getByTestId('rec-meta-r1');
  fireEvent(row, 'layout', layout(rowW));
  fireEvent(screen.getByTestId('rec-meta-badge-r1'), 'layout', layout(badgeW));
  fireEvent(screen.getByTestId('rec-meta-measure-r1', { includeHiddenElements: true }), 'layout', layout(labelW));
  fireEvent(screen.getByTestId('rec-meta-pill-r1'), 'layout', layout(pillW));
}

describe('MetaRow wait label', () => {
  const props = { rideId: 'r1', badge: 'go' as const, waitLabel: '120 min wait', walkOn: false, walkMinutes: 4 };

  it('keeps "min wait" when everything fits', () => {
    render(<MetaRow {...props} />);
    measure(260, 110, 80, 54); // 110 + 80 + 54 + 2×8 = 260
    expect(screen.getByTestId('rec-meta-wait-r1')).toHaveTextContent('120 min wait');
  });

  it('drops "wait" when the full label would not fit', () => {
    render(<MetaRow {...props} />);
    measure(259, 110, 80, 54);
    expect(screen.getByTestId('rec-meta-wait-r1')).toHaveTextContent('120 min');
  });

  it('leaves Walk On alone even when tight', () => {
    render(<MetaRow {...props} waitLabel="Walk On" walkOn />);
    measure(100, 110, 60, 54);
    expect(screen.getByTestId('rec-meta-wait-r1')).toHaveTextContent('Walk On');
  });
});
