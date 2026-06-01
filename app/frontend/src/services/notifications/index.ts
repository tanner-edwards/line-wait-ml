// Single factory entry point. The rest of the app should import
// `getNotificationService()` from here — never construct an impl directly.
// When the native swap happens (Phase v6+), this is the only place the
// wiring changes.

import { NotificationService } from './NotificationService';
import { WebPushNotificationService } from './WebPushNotificationService';

let instance: NotificationService | null = null;

export function getNotificationService(): NotificationService {
  if (!instance) {
    instance = new WebPushNotificationService();
  }
  return instance;
}

export type { NotificationService, PermissionResult, PushSubscription, PushTokenType } from './NotificationService';

// Test helper — lets tests swap in a stub implementation.
export function _setNotificationServiceForTests(svc: NotificationService | null): void {
  instance = svc;
}
