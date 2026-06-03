// Bell button rendered in the Home + Recommendations headers. Tap opens
// the NotificationHistorySheet via NotificationDetailContext. The sheet
// itself is rendered at the root (see App.tsx) so it can coordinate
// with the ride detail modal — opening one closes the other.

import React from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useDevice } from '../context/DeviceContext';
import { useNotificationDetail } from '../context/NotificationDetailContext';

export function NotificationBellButton(): React.ReactElement | null {
  const { notificationsEnabled } = useDevice();
  const { openHistorySheet } = useNotificationDetail();
  if (!notificationsEnabled) return null;
  return (
    <Pressable
      onPress={openHistorySheet}
      style={styles.button}
      testID="notification-bell"
      hitSlop={10}
    >
      <Text style={styles.icon}>🔔</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    paddingHorizontal: 8,
    paddingVertical: 8,
  },
  icon: {
    fontSize: 20,
  },
});
