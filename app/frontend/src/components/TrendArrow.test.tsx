import React from 'react';
import { render } from '@testing-library/react-native';
import { TrendArrow, trajectoryDirection } from './TrendArrow';

describe('trajectoryDirection — maps the server ML trajectory to a row arrow', () => {
  it("rising and trough → 'up' (Rising)", () => {
    expect(trajectoryDirection('rising')).toBe('up');
    expect(trajectoryDirection('trough')).toBe('up');
  });

  it("falling and peak → 'down' (Dropping)", () => {
    expect(trajectoryDirection('falling')).toBe('down');
    expect(trajectoryDirection('peak')).toBe('down');
  });

  it('stable and null are suppressed (no arrow)', () => {
    expect(trajectoryDirection('stable')).toBeNull();
    expect(trajectoryDirection(null)).toBeNull();
  });
});

describe('TrendArrow', () => {
  it('renders an up arrow with testID trend-arrow-up', () => {
    const { getByTestId } = render(<TrendArrow direction="up" />);
    expect(getByTestId('trend-arrow-up')).toBeTruthy();
  });

  it('renders a down arrow with testID trend-arrow-down', () => {
    const { getByTestId } = render(<TrendArrow direction="down" />);
    expect(getByTestId('trend-arrow-down')).toBeTruthy();
  });
});
