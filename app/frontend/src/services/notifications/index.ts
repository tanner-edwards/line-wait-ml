// Single factory entry point. The rest of the app should import
// `getNotificationService()` from here — never construct an impl directly.
// Platform detection happens here — web gets WebPush/VAPID; native gets
// expo-notifications (ExpoNotificationService).

import { Platform } from 'react-native';
import { NotificationService } from './NotificationService';
import { WebPushNotificationService } from './WebPushNotificationService';
import { ExpoNotificationService } from './ExpoNotificationService';

let instance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!instance) {
    instance = Platform.OS === 'web'
      ? new WebPushNotificationService()
      : new ExpoNotificationService();
  }
  return instance;
}

export type { NotificationService, PermissionResult, PushSubscription, PushTokenType } from './NotificationService';

// Test helper — lets tests swap in a stub implementation.
export function _setNotificationServiceForTests(svc: NotificationService | null): void {
  instance = svc;
}
