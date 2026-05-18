import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { BelowNormalBadge } from './BelowNormalBadge';

describe('BelowNormalBadge', () => {
  it('renders nothing when currentWait is null', () => {
    const { toJSON } = render(
      <BelowNormalBadge currentWait={null} bucket0Wait={30} sampleCount={50} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when bucket0Wait is null', () => {
    const { toJSON } = render(
      <BelowNormalBadge currentWait={20} bucket0Wait={null} sampleCount={50} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when bucket0Wait is 0 (would divide by zero)', () => {
    const { toJSON } = render(
      <BelowNormalBadge currentWait={20} bucket0Wait={0} sampleCount={50} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders nothing when sampleCount is below the 20 confidence threshold', () => {
    const { toJSON } = render(
      <BelowNormalBadge currentWait={5} bucket0Wait={40} sampleCount={19} />
    );
    expect(toJSON()).toBeNull();
  });

  it('renders "Below normal" when currentWait is materially lower than bucket0Wait', () => {
    render(
      <BelowNormalBadge currentWait={10} bucket0Wait={40} sampleCount={50} />
    );
    expect(screen.getByTestId('below-normal-badge')).toBeTruthy();
    expect(screen.getByText('Below normal')).toBeTruthy();
  });

  it('renders "Above normal" when currentWait is materially higher than bucket0Wait', () => {
    render(
      <BelowNormalBadge currentWait={60} bucket0Wait={40} sampleCount={50} />
    );
    expect(screen.getByTestId('above-normal-badge')).toBeTruthy();
    expect(screen.getByText('Above normal')).toBeTruthy();
  });

  it('renders nothing when currentWait is within ±25% of bucket0Wait', () => {
    const { toJSON } = render(
      <BelowNormalBadge currentWait={42} bucket0Wait={40} sampleCount={50} />
    );
    expect(toJSON()).toBeNull();
  });

  it('boundary: exactly 0.75× treats as in-band (not below) — strict < threshold', () => {
    // currentWait === bucket0 * 0.75 is NOT < bucket0 * 0.75, so no badge.
    const { toJSON } = render(
      <BelowNormalBadge currentWait={30} bucket0Wait={40} sampleCount={50} />
    );
    expect(toJSON()).toBeNull();
  });

  it('boundary: exactly 1.25× treats as in-band (not above) — strict > threshold', () => {
    const { toJSON } = render(
      <BelowNormalBadge currentWait={50} bucket0Wait={40} sampleCount={50} />
    );
    expect(toJSON()).toBeNull();
  });
});
