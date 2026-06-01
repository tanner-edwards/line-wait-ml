// Notification service abstraction. The adapter pattern lets us swap the
// underlying push implementation (Web Push for PWA today, Expo Push for
// native later) without touching the UI code. App code only sees this
// interface — never the concrete impl.

export type PushTokenType = 'web' | 'expo';

export interface PushSubscription {
  token: string;
  type: PushTokenType;
}

export type PermissionResult = 'granted' | 'denied' | 'unsupported';

export interface NotificationService {
  /**
   * Trigger the OS permission prompt. Returns 'granted', 'denied', or
   * 'unsupported' (e.g., Web Push not available in this browser/PWA mode).
   * Idempotent — safe to call multiple times.
   */
  requestPermission(): Promise<PermissionResult>;

  /**
   * Return the current push subscription if one exists. Returns null when
   * permission hasn't been granted or no subscription has been created yet.
   * The token shape depends on the implementation (Web Push subscription
   * JSON string vs Expo opaque token).
   */
  getSubscription(): Promise<PushSubscription | null>;
}
