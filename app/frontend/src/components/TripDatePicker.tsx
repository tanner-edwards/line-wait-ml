// Reusable date range picker for trip access (free + IAP).
// Collapsed by default — each row shows the selected date; tapping expands
// a native iOS spinner wheel inline. Only one field open at a time.
//
// The initial length comes from the persona's tripDuration. The end date
// follows the start date at that length until the user edits the end
// themselves — after that, moving the start only clamps it.
//
// Editing an existing trip passes `initial` (its current dates) and `limits`
// (utils/tripEdit): bounds the start, can lock it, and caps the end.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { ChevronDown, ChevronUp } from 'lucide-react-native';
import { colors, radius, spacing, typography } from '../theme/tokens';
import { TripDuration } from '../types';
import { addDays, defaultTripDays, stripTime, toYMD } from '../utils/tripDefaults';
import { TripEditLimits } from '../utils/tripEdit';

export interface TripDateRange {
  tripStart: string; // YYYY-MM-DD
  tripEnd: string;   // YYYY-MM-DD
}

interface Props {
  onChange: (range: TripDateRange) => void;
  /** From persona; sets the initial trip length. Omitted → 3 days. */
  tripDuration?: TripDuration | null;
  /** Existing trip's dates — editing instead of buying. */
  initial?: TripDateRange;
  /** Edit bounds for an existing trip. */
  limits?: TripEditLimits;
}

const MAX_DAYS = 10;
const MAX_START_DAYS_OUT = 90;

function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86_400_000);
}

function fromYMD(ymd: string): Date {
  return new Date(ymd + 'T00:00:00');
}

function formatDate(date: Date): string {
  return date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });
}

type ActiveField = 'start' | 'end' | null;

export function TripDatePicker({ onChange, tripDuration = null, initial, limits }: Props): React.ReactElement {
  const today = stripTime(new Date());
  const minStart = limits ? fromYMD(limits.minStart) : today;
  const maxStart = limits ? fromYMD(limits.maxStart) : addDays(today, MAX_START_DAYS_OUT);
  const endCap = limits?.endCap ? fromYMD(limits.endCap) : null;
  const startLocked = limits?.startLocked ?? false;
  const lengthDays = defaultTripDays(tripDuration);

  const [startDate, setStartDate] = useState(initial ? fromYMD(initial.tripStart) : today);
  const [endDate, setEndDate] = useState(
    initial ? fromYMD(initial.tripEnd) : addDays(today, lengthDays - 1)
  );
  const [endTouched, setEndTouched] = useState(!!initial);
  const [active, setActive] = useState<ActiveField>(null);

  // 10 days from the start, and never past the post-access cap.
  const maxEndFor = (start: Date) => {
    const byLength = addDays(start, MAX_DAYS - 1);
    return endCap && endCap < byLength ? endCap : byLength;
  };
  // Mid-trip the start is in the past, but the end can't be.
  const minEndFor = (start: Date) => (start < today ? today : start);

  const toggle = (field: 'start' | 'end') =>
    setActive(prev => (prev === field ? null : field));

  const handleStartChange = (_: unknown, selected?: Date) => {
    if (!selected) return;
    const next = stripTime(selected);
    let nextEnd = endTouched ? endDate : addDays(next, lengthDays - 1);
    if (nextEnd < minEndFor(next)) nextEnd = minEndFor(next);
    if (nextEnd > maxEndFor(next)) nextEnd = maxEndFor(next);
    setStartDate(next);
    setEndDate(nextEnd);
    onChange({ tripStart: toYMD(next), tripEnd: toYMD(nextEnd) });
  };

  const handleEndChange = (_: unknown, selected?: Date) => {
    if (!selected) return;
    let next = stripTime(selected);
    if (next < minEndFor(startDate)) next = minEndFor(startDate);
    if (next > maxEndFor(startDate)) next = maxEndFor(startDate);
    setEndTouched(true);
    setEndDate(next);
    onChange({ tripStart: toYMD(startDate), tripEnd: toYMD(next) });
  };

  const nights = daysBetween(startDate, endDate);
  const days = nights + 1;
  const summary = days === 1 ? '1 day' : `${days} days`;
  const atMax = days >= MAX_DAYS;
  const atCap = !atMax && endCap !== null && endDate >= endCap;

  return (
    <View style={styles.container}>
      {/* Start date row */}
      <Pressable
        style={({ pressed }) => [styles.row, pressed && !startLocked && styles.rowPressed]}
        onPress={() => toggle('start')}
        disabled={startLocked}
        testID="trip-start-row"
      >
        <Text style={styles.label}>Start date</Text>
        <View style={styles.rowRight}>
          <Text style={[styles.value, startLocked && styles.valueLocked]}>{formatDate(startDate)}</Text>
          {startLocked ? null : active === 'start'
            ? <ChevronUp size={15} color={colors.textTertiary} />
            : <ChevronDown size={15} color={colors.textTertiary} />}
        </View>
      </Pressable>

      {active === 'start' && (
        <DateTimePicker
          value={startDate}
          mode="date"
          display="spinner"
          minimumDate={minStart}
          maximumDate={maxStart}
          onChange={handleStartChange}
          style={styles.picker}
          textColor={colors.textPrimary}
          accentColor={colors.brand}
        />
      )}

      <View style={styles.divider} />

      {/* End date row */}
      <Pressable
        style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
        onPress={() => toggle('end')}
      >
        <Text style={styles.label}>End date</Text>
        <View style={styles.rowRight}>
          <Text style={styles.value}>{formatDate(endDate)}</Text>
          {active === 'end'
            ? <ChevronUp size={15} color={colors.textTertiary} />
            : <ChevronDown size={15} color={colors.textTertiary} />}
        </View>
      </Pressable>

      {active === 'end' && (
        <DateTimePicker
          value={endDate}
          mode="date"
          display="spinner"
          minimumDate={minEndFor(startDate)}
          maximumDate={maxEndFor(startDate)}
          onChange={handleEndChange}
          style={styles.picker}
          textColor={colors.textPrimary}
          accentColor={colors.brand}
        />
      )}

      <View style={styles.divider} />

      <Text style={styles.summary}>{summary}</Text>
      {atMax && (
        <Text style={styles.maxError}>Trips are limited to 10 days</Text>
      )}
      {atCap && (
        <Text style={styles.maxError}>Trips are limited to 10 days from your first day of access</Text>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xs,
    borderRadius: radius.sm,
  },
  rowPressed: { backgroundColor: colors.border },
  rowRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
  },
  label: {
    ...typography.label,
    color: colors.textSecondary,
  },
  value: {
    ...typography.label,
    color: colors.textPrimary,
    fontWeight: '600',
  },
  valueLocked: { color: colors.textSecondary },
  picker: {
    width: '100%',
    height: 120,
  },
  divider: {
    height: 1,
    backgroundColor: colors.border,
  },
  summary: {
    ...typography.caption,
    color: colors.textTertiary,
    textAlign: 'center',
    paddingTop: spacing.sm,
  },
  maxError: {
    ...typography.caption,
    color: colors.skip,
    textAlign: 'center',
    paddingTop: spacing.xs,
  },
});
