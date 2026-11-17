import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { VerdictBadge } from './VerdictBadge';

describe('VerdictBadge', () => {
  it.each([
    ['star', 'RARE FIND'],
    ['go', 'RIDE IT'],
    ['skip', "DON'T GO"],
  ] as const)('%s reads "%s"', (variant, label) => {
    render(<VerdictBadge variant={variant} />);
    expect(screen.getByTestId(`badge-${variant}`)).toBeTruthy();
    expect(screen.getByText(label)).toBeTruthy();
  });
});
