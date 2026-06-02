// Bell button rendered in the Home + Recommendations headers. Tap opens
// the NotificationHistorySheet. Hidden when notifications are disabled —
// no point showing a bell to users who haven't opted in.

import React, { useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { useDevice } from '../context/DeviceContext';
import { NotificationHistorySheet } from './NotificationHistorySheet';

export function NotificationBellButton(): React.ReactElement | null {
  const { notificationsEnabled } = useDevice();
  const [open, setOpen] = useState(false);
  if (!notificationsEnabled) return null;
  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        style={styles.button}
        testID="notification-bell"
        hitSlop={10}
      >
        <Text style={styles.icon}>🔔</Text>
      </Pressable>
      <NotificationHistorySheet visible={open} onClose={() => setOpen(false)} />
    </>
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
