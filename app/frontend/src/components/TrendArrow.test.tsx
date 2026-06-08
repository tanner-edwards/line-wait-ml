import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { TrendArrow } from './TrendArrow';

// Minimal helper — pass only the fields the test cares about, rest default to null.
const defaults = {
  currentWait: null,
  recentWait: null,
  bucket1Wait: null,
  bucket3Wait: null,
  bucket4Wait: null,
  lowConfidence: false,
};

describe('TrendArrow', () => {
  it('renders nothing when currentWait is null', () => {
    const { toJSON } = render(<TrendArrow {...defaults} bucket4Wait={20} />);
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when neither past nor future signals exist', () => {
    const { toJSON } = render(<TrendArrow {...defaults} currentWait={30} />);
    expect(toJSON()).toBeNull();
  });

  it("renders 'down' direction when combined delta is materially negative", () => {
    // recent=50 → current=30 → past=-20. Future stays at 30. Combined -20 → down.
    render(<TrendArrow
      {...defaults}
      currentWait={30}
      recentWait={50}
      bucket1Wait={30}
      bucket3Wait={30}
      bucket4Wait={30}
    />);
    expect(screen.getByTestId('trend-arrow-down')).toBeTruthy();
  });

  it("renders 'up' direction when combined delta is materially positive", () => {
    // recent=30 → current=30 (past=0). Future 60s. earlyAvg=30, lateAvg=60, +30 → up.
    render(<TrendArrow
      {...defaults}
      currentWait={30}
      recentWait={30}
      bucket1Wait={30}
      bucket3Wait={60}
      bucket4Wait={60}
    />);
    expect(screen.getByTestId('trend-arrow-up')).toBeTruthy();
  });

  it("renders 'stable' when combined delta is within ±5 min", () => {
    render(<TrendArrow
      {...defaults}
      currentWait={30}
      recentWait={30}
      bucket1Wait={30}
      bucket3Wait={31}
      bucket4Wait={31}
    />);
    expect(screen.getByTestId('trend-arrow-stable')).toBeTruthy();
  });

  it('low-confidence variant adds the -low-conf testID suffix', () => {
    render(<TrendArrow
      {...defaults}
      currentWait={30}
      bucket1Wait={30}
      bucket3Wait={60}
      bucket4Wait={60}
      lowConfidence
    />);
    expect(screen.getByTestId('trend-arrow-up-low-conf')).toBeTruthy();
  });

  // Regression
  it('Space Mountain 6pm — current=60, future climbs to 73-79 → up (was Steady before fix)', () => {
    render(<TrendArrow
      {...defaults}
      currentWait={60}
      recentWait={60}
      bucket1Wait={73}
      bucket3Wait={79}
      bucket4Wait={74}
    />);
    expect(screen.getByTestId('trend-arrow-up')).toBeTruthy();
  });

  it('Winnie 9pm at floor — current=5, recent=5, future bounces back to floor → stable', () => {
    render(<TrendArrow
      {...defaults}
      currentWait={5}
      recentWait={5}
      bucket1Wait={11}
      bucket3Wait={6}
      bucket4Wait={6}
    />);
    expect(screen.getByTestId('trend-arrow-stable')).toBeTruthy();
  });
});
