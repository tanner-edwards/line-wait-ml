// Web Push implementation of NotificationService. Phase A is a SKELETON —
// permission/subscription wiring is finished in Phase B (VAPID keys,
// service worker registration, push manager subscribe). For now it just
// reports whether the platform supports notifications and returns a stub
// permission result so the Profile UI can be tested end-to-end.

import { NotificationService, PermissionResult, PushSubscription } from './NotificationService';

export class WebPushNotificationService implements NotificationService {
  async requestPermission(): Promise<PermissionResult> {
    if (typeof globalThis === 'undefined' || !('Notification' in globalThis)) {
      return 'unsupported';
    }
    const NotificationApi = (globalThis as { Notification?: { permission: string; requestPermission?: () => Promise<string> } }).Notification;
    if (!NotificationApi || typeof NotificationApi.requestPermission !== 'function') {
      return 'unsupported';
    }
    try {
      const result = await NotificationApi.requestPermission();
      if (result === 'granted') return 'granted';
      return 'denied';
    } catch {
      return 'denied';
    }
  }

  async getSubscription(): Promise<PushSubscription | null> {
    // Phase B will hook this up to the Service Worker's PushManager.
    // For Phase A, returning null means the backend record is created
    // with pushToken=null — registration still works, just no delivery.
    return null;
  }
}
