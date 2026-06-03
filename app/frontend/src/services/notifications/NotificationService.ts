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

  /**
   * Force a fresh subscription: unsubscribe any existing one and create
   * a new endpoint. Used by the "re-enable notifications" flow so the
   * browser doesn't hand back a cached subscription that the push
   * service has already pruned (Web Push on iOS, mainly).
   */
  resubscribe(): Promise<PushSubscription | null>;
}
