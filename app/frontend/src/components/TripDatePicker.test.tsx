// The end date follows the start date at the persona's trip length until the
// user edits the end date themselves; after that, moving the start only clamps.

import React from 'react';
import { fireEvent, render, screen } from '@testing-library/react-native';
import { TripDatePicker } from './TripDatePicker';

// The native spinner can't run in jest. Stand in a button that fires onChange
// with whatever date the test stashes in `mockNextPick`.
let mockNextPick: Date | null = null;
jest.mock('@react-native-community/datetimepicker', () => {
  const RN = require('react-native');
  return {
    __esModule: true,
    default: ({ onChange }: { onChange: (e: unknown, d?: Date) => void }) => (
      <RN.Pressable testID="spinner" onPress={() => onChange({}, mockNextPick ?? undefined)}>
        <RN.Text>spinner</RN.Text>
      </RN.Pressable>
    ),
  };
});

const today = new Date();
today.setHours(0, 0, 0, 0);
const plus = (n: number) => { const d = new Date(today); d.setDate(d.getDate() + n); return d; };
const fmt = (d: Date) => d.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

function pick(field: 'Start date' | 'End date', date: Date) {
  mockNextPick = date;
  fireEvent.press(screen.getByText(field));
  fireEvent.press(screen.getByTestId('spinner'));
  fireEvent.press(screen.getByText(field)); // collapse
}

beforeEach(() => { jest.useFakeTimers().setSystemTime(today); });
afterEach(() => { jest.useRealTimers(); });

it('seeds the end date from the persona trip length', () => {
  render(<TripDatePicker tripDuration="2-days" onChange={jest.fn()} />);
  expect(screen.getByText(fmt(plus(1)))).toBeTruthy();
  expect(screen.getByText('2 days')).toBeTruthy();
});

it('keeps the pre-persona 3-day default when no duration is given', () => {
  render(<TripDatePicker onChange={jest.fn()} />);
  expect(screen.getByText(fmt(plus(2)))).toBeTruthy();
});

it('moves the end date with the start date until the end is edited', () => {
  const onChange = jest.fn();
  render(<TripDatePicker tripDuration="2-days" onChange={onChange} />);

  pick('Start date', plus(5));
  expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({ tripEnd: expect.any(String) }));
  expect(screen.getByText(fmt(plus(6)))).toBeTruthy(); // end followed: +5 → +6

  pick('End date', plus(9));                            // user takes over the end
  pick('Start date', plus(2));
  expect(screen.getByText(fmt(plus(9)))).toBeTruthy(); // end stayed put
});

it('still clamps a user-set end date when the start passes it', () => {
  render(<TripDatePicker tripDuration="1-day" onChange={jest.fn()} />);
  pick('End date', plus(3));
  pick('Start date', plus(7));
  expect(screen.getAllByText(fmt(plus(7)))).toHaveLength(2); // start and end both +7
});
