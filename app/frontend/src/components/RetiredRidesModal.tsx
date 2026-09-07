// Mid-trip management for swipe-retired rides — view what's been marked
// "Rode it" this trip and undo any of them (they'll start reappearing in
// recs again). Not PersonaFieldModal: retired rides live in DeviceContext,
// not PersonaContext, and there's no "add" flow here, only "remove".

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { X } from 'lucide-react-native';
import { Sheet } from './Sheet';
import { useDevice } from '../context/DeviceContext';
import { useRides } from '../context/RideContext';
import { colors, radius, spacing, typography } from '../theme/tokens';

interface RetiredRidesModalProps {
  visible: boolean;
  onClose: () => void;
}

export function RetiredRidesModal({ visible, onClose }: RetiredRidesModalProps): React.ReactElement {
  const { retiredRideIds, unretireRide } = useDevice();
  const { data } = useRides();

  const allRides = data?.parks.flatMap(p => ('rides' in p ? p.rides : [])) ?? [];
  const entries = retiredRideIds
    .map(id => ({ id, name: allRides.find(r => r.id === id)?.name }))
    .filter((e): e is { id: string; name: string } => typeof e.name === 'string');

  return (
    <Sheet isOpen={visible} onClose={onClose} title="Ridden rides" testID="retired-rides-modal">
      {entries.length === 0 ? (
        <Text style={styles.empty}>
          Nothing ridden yet — swipe a recommendation card and tap "Rode it" to stop seeing it for the rest of the trip.
        </Text>
      ) : (
        entries.map(entry => (
          <View style={styles.row} key={entry.id}>
            <Text style={styles.name} numberOfLines={1}>{entry.name}</Text>
            <Pressable
              onPress={() => unretireRide(entry.id)}
              hitSlop={8}
              testID={`retired-ride-remove-${entry.id}`}
            >
              <X size={18} color={colors.textTertiary} />
            </Pressable>
          </View>
        ))
      )}
    </Sheet>
  );
}

const styles = StyleSheet.create({
  empty: {
    ...typography.body,
    color: colors.textSecondary,
    textAlign: 'center',
    paddingVertical: spacing.xl,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.base,
    marginBottom: spacing.sm,
  },
  name: {
    ...typography.body,
    color: colors.textPrimary,
    flex: 1,
    marginRight: spacing.md,
  },
});
