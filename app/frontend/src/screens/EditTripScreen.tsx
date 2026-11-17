// Edit the dates of the user's trip — opened from the Profile trip row.
// Same TripDatePicker as the claim/paywall flows, prefilled with the current
// dates and bounded by utils/tripEdit (the server re-checks on save).

import React, { useRef, useState } from 'react';
import {
  ActivityIndicator,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronLeft } from 'lucide-react-native';
import { updateTripDates } from '../api';
import { TripDatePicker, TripDateRange } from '../components/TripDatePicker';
import { useAuth } from '../context/AuthContext';
import { useTrip } from '../context/TripContext';
import { TripRecord } from '../types';
import { stripTime, toYMD } from '../utils/tripDefaults';
import { tripEditLimits } from '../utils/tripEdit';
import { colors, radius, shadows, spacing, typography } from '../theme/tokens';

interface EditTripScreenProps {
  trip: TripRecord;
  onClose: () => void;
}

export function EditTripScreen({ trip, onClose }: EditTripScreenProps): React.ReactElement {
  const { getIdToken } = useAuth();
  const { refetchTrip } = useTrip();
  const limits = tripEditLimits(trip, toYMD(stripTime(new Date())));
  const rangeRef = useRef<TripDateRange>({ tripStart: trip.tripStart, tripEnd: trip.tripEnd });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSave = async () => {
    setError(null);
    setSaving(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Not signed in');
      await updateTripDates(token, rangeRef.current);
      await refetchTrip();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={12} testID="edit-trip-close">
          <ChevronLeft size={22} color={colors.textSecondary} />
        </TouchableOpacity>
      </View>
      <ScrollView contentContainerStyle={styles.scroll} showsVerticalScrollIndicator={false}>
        <Text style={styles.headline}>Edit trip dates</Text>
        {limits ? (
          <>
            <Text style={styles.sub}>
              {limits.startLocked
                ? 'Your trip has started, so only the end date can change.'
                : 'Plans changed? Move your trip, up to 10 days long.'}
            </Text>
            <View style={styles.pickerCard}>
              <TripDatePicker
                initial={{ tripStart: trip.tripStart, tripEnd: trip.tripEnd }}
                limits={limits}
                onChange={range => { rangeRef.current = range; }}
              />
            </View>
            {error ? <Text style={styles.error}>{error}</Text> : null}
          </>
        ) : (
          <Text style={styles.sub}>This trip has ended, so its dates can't change.</Text>
        )}
      </ScrollView>
      {limits ? (
        <View style={styles.footer}>
          <TouchableOpacity
            style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
            onPress={() => void handleSave()}
            disabled={saving}
            activeOpacity={0.85}
            testID="edit-trip-save"
          >
            {saving
              ? <ActivityIndicator color={colors.textInverse} />
              : <Text style={styles.saveBtnText}>Save dates</Text>}
          </TouchableOpacity>
        </View>
      ) : null}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: colors.bg },
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    gap: spacing.base,
  },
  headline: {
    ...typography.screenTitle,
    color: colors.textPrimary,
  },
  sub: {
    ...typography.body,
    color: colors.textSecondary,
    lineHeight: 22,
  },
  pickerCard: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    padding: spacing.xl,
    ...shadows.card,
  },
  error: {
    ...typography.caption,
    color: colors.skip,
    textAlign: 'center',
  },
  footer: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xl,
    paddingTop: spacing.base,
  },
  saveBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    ...shadows.card,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: {
    ...typography.label,
    fontSize: 16,
    color: colors.textInverse,
  },
});
