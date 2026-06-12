// Smart wrapper — bottom-sheet for per-type notification opt-ins. Reads
// + writes the device record; renders a NotificationToggleList for the
// actual UI. Changes persist to AsyncStorage via the device context and
// sync to the device record so the scanner respects them on the next tick.

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { colors } from '../theme/tokens';
import { useDevice } from '../context/DeviceContext';
import { Sheet } from './Sheet';
import { NotificationToggleList } from './NotificationToggleList';

interface Props {
  visible: boolean;
  onClose: () => void;
}

export function NotificationSettingsModal({ visible, onClose }: Props): React.ReactElement {
  const { notificationTypes, setNotificationTypeEnabled } = useDevice();
  return (
    <Sheet
      isOpen={visible}
      onClose={onClose}
      title="Notification types"
      testID="notif-settings"
    >
      <NotificationToggleList
        types={notificationTypes}
        onChange={(kind, enabled) => void setNotificationTypeEnabled(kind, enabled)}
      />
      <Text style={styles.footer}>
        Notifications only send while you're at the park.
      </Text>
    </Sheet>
  );
}

const styles = StyleSheet.create({
  footer: { fontSize: 11, color: colors.textTertiary, marginTop: 14, textAlign: 'center' },
});
