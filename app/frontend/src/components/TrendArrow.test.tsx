import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { TrendArrow } from './TrendArrow';

describe('TrendArrow', () => {
  it('renders nothing when bucket0Wait is null', () => {
    const { toJSON } = render(
      <TrendArrow bucket0Wait={null} bucket2Wait={20} lowConfidence={false} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when bucket2Wait is null', () => {
    const { toJSON } = render(
      <TrendArrow bucket0Wait={30} bucket2Wait={null} lowConfidence={false} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when bucket0Wait is 0 (would divide by zero)', () => {
    const { toJSON } = render(
      <TrendArrow bucket0Wait={0} bucket2Wait={15} lowConfidence={false} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders a green ↘ when bucket2 is materially less than bucket0', () => {
    render(<TrendArrow bucket0Wait={50} bucket2Wait={25} lowConfidence={false} />);
    expect(screen.getByTestId('trend-arrow-down')).toBeTruthy();
    expect(screen.getByText('↘')).toBeTruthy();
  });

  it('renders a red ↗ when bucket2 is materially greater than bucket0', () => {
    render(<TrendArrow bucket0Wait={30} bucket2Wait={60} lowConfidence={false} />);
    expect(screen.getByTestId('trend-arrow-up')).toBeTruthy();
    expect(screen.getByText('↗')).toBeTruthy();
  });

  it('renders a gray → when within ±10%', () => {
    render(<TrendArrow bucket0Wait={30} bucket2Wait={31} lowConfidence={false} />);
    expect(screen.getByTestId('trend-arrow-stable')).toBeTruthy();
    expect(screen.getByText('→')).toBeTruthy();
  });

  it('uses the low-confidence testID variant when lowConfidence is true', () => {
    render(<TrendArrow bucket0Wait={50} bucket2Wait={25} lowConfidence={true} />);
    expect(screen.getByTestId('trend-arrow-down-low-conf')).toBeTruthy();
  });

  it('boundary: exactly 0.9× treats as stable (not down) — strict < threshold', () => {
    // bucket2 === bucket0 * 0.9 is NOT < bucket0 * 0.9, so this is stable.
    render(<TrendArrow bucket0Wait={50} bucket2Wait={45} lowConfidence={false} />);
    expect(screen.getByTestId('trend-arrow-stable')).toBeTruthy();
  });

  it('boundary: exactly 1.1× treats as stable (not up) — strict > threshold', () => {
    render(<TrendArrow bucket0Wait={50} bucket2Wait={55} lowConfidence={false} />);
    expect(screen.getByTestId('trend-arrow-stable')).toBeTruthy();
  });
});
