// Bell button in the Home + Recommendations gradient headers.
// Always rendered on a dark gradient — uses inverse (white) color.

import React from 'react';
import { Pressable, StyleSheet } from 'react-native';
import { Bell } from 'lucide-react-native';
import { colors } from '../theme/tokens';
import { useDevice } from '../context/DeviceContext';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { useTrip } from '../context/TripContext';

export function NotificationBellButton(): React.ReactElement | null {
  const { notificationsEnabled } = useDevice();
  const { openHistorySheet } = useNotificationDetail();
  const { hasActiveTrip } = useTrip();
  if (!notificationsEnabled || !hasActiveTrip) return null;
  return (
    <Pressable
      onPress={() => openHistorySheet()}
      style={styles.button}
      testID="notification-bell"
      hitSlop={10}
    >
      <Bell size={20} color={colors.textInverse} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
});
