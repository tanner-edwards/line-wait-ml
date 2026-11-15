import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { DiscoverChip, DiscoverChips } from './DiscoverChips';

const layout = (width: number) => ({ nativeEvent: { layout: { width, height: 36, x: 0, y: 0 } } });

const KEYS = ['nearby', 'land', 'list', 'opportunity', 'wait', 'demand', 'az'];

// Every chip measures 80 wide, More 60; gap is 8.
function measure(rowW: number) {
  fireEvent(screen.getByTestId('chips-row'), 'layout', layout(rowW));
  const hidden = { includeHiddenElements: true };
  KEYS.forEach(k => fireEvent(screen.getByTestId(`chip-measure-${k}`, hidden), 'layout', layout(80)));
  fireEvent(screen.getByTestId('chip-measure-more', hidden), 'layout', layout(60));
}

function setup(active: DiscoverChip = 'nearby') {
  const onSelect = jest.fn();
  const utils = render(<DiscoverChips active={active} landLabel={null} onSelect={onSelect} />);
  return { ...utils, onSelect };
}

describe('DiscoverChips', () => {
  it('shows every chip before measurement', () => {
    setup();
    expect(screen.getByTestId('chip-az')).toBeTruthy();
  });

  it('fits as many chips as the row allows, then More', () => {
    setup();
    measure(330); // 3×80 + More 60 + 3 gaps×8 = 324
    expect(screen.getByTestId('chip-list')).toBeTruthy();
    expect(screen.queryByTestId('chip-opportunity')).toBeNull();
    expect(screen.getByTestId('chip-more')).toBeTruthy();
  });

  it('More expands the hidden chips; picking one collapses and selects it', () => {
    const { onSelect } = setup();
    measure(330);
    fireEvent.press(screen.getByTestId('chip-more'));
    expect(screen.getByTestId('chips-expanded')).toBeTruthy();

    fireEvent.press(screen.getByTestId('chip-wait'));
    expect(onSelect).toHaveBeenCalledWith('wait');
    expect(screen.queryByTestId('chips-expanded')).toBeNull();
  });

  it('puts the active chip first', () => {
    setup('demand');
    measure(330);
    const chips = screen.getAllByRole('button').map(b => b.props.testID).filter(Boolean);
    expect(chips.slice(0, 4)).toEqual(['chip-demand', 'chip-nearby', 'chip-land', 'chip-more']);
  });

  it('drops More when everything fits', () => {
    setup();
    measure(1000);
    expect(screen.queryByTestId('chip-more')).toBeNull();
    expect(screen.getByTestId('chip-az')).toBeTruthy();
  });
});
