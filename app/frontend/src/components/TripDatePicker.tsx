// Reusable date range picker for trip claiming (free trip + IAP).
// User picks a start date (today + up to 60 days out) and a duration (1–10 days).
// End date is computed. Calls onChange whenever the selection changes.

import React, { useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { ChevronLeft, ChevronRight } from 'lucide-react-native';
import { colors, radius, spacing, typography } from '../theme/tokens';

export interface TripDateRange {
  tripStart: string; // YYYY-MM-DD
  tripEnd: string;   // YYYY-MM-DD
}

interface Props {
  onChange: (range: TripDateRange) => void;
}

const MAX_DURATION = 10;
const MAX_START_OFFSET = 60; // days from today

function toYMD(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function addDays(date: Date, n: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + n);
  return d;
}

function formatDisplay(date: Date): string {
  return date.toLocaleDateString('en-US', {
    weekday: 'short', month: 'short', day: 'numeric',
  });
}

function formatRange(start: Date, end: Date): string {
  const opts: Intl.DateTimeFormatOptions = { month: 'short', day: 'numeric' };
  const s = start.toLocaleDateString('en-US', opts);
  const e = end.toLocaleDateString('en-US', opts);
  return `${s} – ${e}`;
}

export function TripDatePicker({ onChange }: Props): React.ReactElement {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const [startOffset, setStartOffset] = useState(0); // days from today
  const [duration, setDuration] = useState(3);       // 1–10

  const startDate = addDays(today, startOffset);
  const endDate = addDays(startDate, duration - 1);

  const updateStart = (offset: number) => {
    const clamped = Math.max(0, Math.min(MAX_START_OFFSET, offset));
    setStartOffset(clamped);
    onChange({ tripStart: toYMD(addDays(today, clamped)), tripEnd: toYMD(addDays(addDays(today, clamped), duration - 1)) });
  };

  const updateDuration = (d: number) => {
    const clamped = Math.max(1, Math.min(MAX_DURATION, d));
    setDuration(clamped);
    onChange({ tripStart: toYMD(startDate), tripEnd: toYMD(addDays(startDate, clamped - 1)) });
  };

  return (
    <View style={styles.container}>
      {/* Start date */}
      <View style={styles.row}>
        <Text style={styles.label}>Start date</Text>
        <View style={styles.stepper}>
          <Pressable
            onPress={() => updateStart(startOffset - 1)}
            disabled={startOffset === 0}
            style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed, startOffset === 0 && styles.disabled]}
            hitSlop={8}
          >
            <ChevronLeft size={20} color={startOffset === 0 ? colors.textTertiary : colors.textPrimary} />
          </Pressable>
          <Text style={styles.stepValue}>
            {startOffset === 0 ? 'Today' : formatDisplay(startDate)}
          </Text>
          <Pressable
            onPress={() => updateStart(startOffset + 1)}
            disabled={startOffset === MAX_START_OFFSET}
            style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed, startOffset === MAX_START_OFFSET && styles.disabled]}
            hitSlop={8}
          >
            <ChevronRight size={20} color={startOffset === MAX_START_OFFSET ? colors.textTertiary : colors.textPrimary} />
          </Pressable>
        </View>
      </View>

      {/* Duration */}
      <View style={styles.row}>
        <Text style={styles.label}>Trip length</Text>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.chips} contentContainerStyle={styles.chipsContent}>
          {Array.from({ length: MAX_DURATION }, (_, i) => i + 1).map(d => (
            <Pressable
              key={d}
              onPress={() => updateDuration(d)}
              style={({ pressed }) => [
                styles.chip,
                d === duration && styles.chipActive,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.chipText, d === duration && styles.chipTextActive]}>
                {d === 1 ? '1 day' : `${d} days`}
              </Text>
            </Pressable>
          ))}
        </ScrollView>
      </View>

      {/* Summary */}
      <View style={styles.summary}>
        <Text style={styles.summaryText}>
          {formatRange(startDate, endDate)} · {duration === 1 ? '1 day' : `${duration} days`}
        </Text>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { gap: spacing.lg },
  row: { gap: spacing.sm },
  label: {
    ...typography.label,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    fontSize: 11,
  },
  stepper: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingHorizontal: spacing.sm,
    paddingVertical: 10,
    gap: spacing.base,
  },
  stepBtn: {
    padding: 4,
    borderRadius: 6,
  },
  stepValue: {
    ...typography.body,
    flex: 1,
    textAlign: 'center',
    color: colors.textPrimary,
    fontWeight: '600',
  },
  chips: { marginHorizontal: -spacing.xs },
  chipsContent: { gap: spacing.xs, paddingHorizontal: spacing.xs },
  chip: {
    paddingHorizontal: spacing.base,
    paddingVertical: 8,
    borderRadius: radius.sm,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  chipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  chipText: {
    ...typography.label,
    color: colors.textSecondary,
    fontSize: 13,
  },
  chipTextActive: {
    color: colors.textInverse,
  },
  summary: {
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  summaryText: {
    ...typography.body,
    color: colors.textSecondary,
    fontWeight: '600',
  },
  pressed: { opacity: 0.6 },
  disabled: { opacity: 0.3 },
});
