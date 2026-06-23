// Native push implementation of NotificationService using expo-notifications.
// Used on iOS/Android; the web factory stays on WebPushNotificationService.
//
// Token strategy:
//   1. Try getExpoPushTokenAsync (requires an EAS projectId in app.json extra).
//   2. Fall back to getDevicePushTokenAsync (raw APNs token, no EAS needed).
// Both return type: 'expo'. The backend scanner must use the Expo Push API
// (https://exp.host/--/api/v2/push/send) for expo tokens rather than VAPID.

import * as Notifications from 'expo-notifications';
import Constants from 'expo-constants';
import {
  NotificationService,
  PermissionResult,
  PushSubscription as ClubPushSubscription,
} from './NotificationService';

export class ExpoNotificationService implements NotificationService {
  async requestPermission(): Promise<PermissionResult> {
    const { status: existing } = await Notifications.getPermissionsAsync();
    if (existing === 'granted') return 'granted';

    const { status } = await Notifications.requestPermissionsAsync({
      ios: { allowAlert: true, allowBadge: false, allowSound: true },
    });

    if (status === 'granted') return 'granted';
    if (status === 'denied') return 'denied';
    return 'unsupported';
  }

  async getSubscription(): Promise<ClubPushSubscription | null> {
    return this.acquireToken();
  }

  async resubscribe(): Promise<ClubPushSubscription | null> {
    return this.acquireToken();
  }

  private async acquireToken(): Promise<ClubPushSubscription | null> {
    const { status } = await Notifications.getPermissionsAsync();
    if (status !== 'granted') return null;

    // Try Expo push token first — works when EAS projectId is configured.
    try {
      const projectId = (Constants.expoConfig?.extra as { eas?: { projectId?: string } } | undefined)
        ?.eas?.projectId;
      const result = await Notifications.getExpoPushTokenAsync(
        projectId ? { projectId } : undefined
      );
      return { token: result.data, type: 'expo' };
    } catch {
      // EAS not configured — fall back to raw APNs device token.
    }

    try {
      const result = await Notifications.getDevicePushTokenAsync();
      return { token: result.data as string, type: 'expo' };
    } catch {
      return null;
    }
  }
}
