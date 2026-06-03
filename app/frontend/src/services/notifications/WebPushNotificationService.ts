// Web Push implementation of NotificationService. Wires up the browser's
// Notification + Service Worker + PushManager APIs.
//
// Subscription flow:
//   1. requestPermission() — Notification.requestPermission()
//   2. getSubscription()   — register /sw.js (idempotent), subscribe via
//                            PushManager with the VAPID public key
//   3. The returned token is the serialized PushSubscription JSON; the
//      backend (scanner.js) parses it and uses web-push to deliver.

import { NotificationService, PermissionResult, PushSubscription as ClubPushSubscription } from './NotificationService';

const SERVICE_WORKER_PATH = '/sw.js';

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
      return result === 'granted' ? 'granted' : 'denied';
    } catch {
      return 'denied';
    }
  }

  async getSubscription(): Promise<ClubPushSubscription | null> {
    return this.acquireSubscription({ forceFresh: false });
  }

  async resubscribe(): Promise<ClubPushSubscription | null> {
    return this.acquireSubscription({ forceFresh: true });
  }

  private async acquireSubscription(
    { forceFresh }: { forceFresh: boolean }
  ): Promise<ClubPushSubscription | null> {
    if (!isWebPushSupported()) return null;

    const vapidPublicKey = process.env.EXPO_PUBLIC_VAPID_PUBLIC_KEY;
    if (!vapidPublicKey) {
      console.warn('Web Push: EXPO_PUBLIC_VAPID_PUBLIC_KEY is not set');
      return null;
    }

    // Register the service worker. Idempotent — multiple calls return the
    // same registration. We don't need a separate app-startup hook because
    // this only runs when the user opts in via Profile.
    let registration: ServiceWorkerRegistration;
    try {
      registration = await navigator.serviceWorker.register(SERVICE_WORKER_PATH);
    } catch (err) {
      console.warn('Web Push: service worker registration failed', err);
      return null;
    }

    // Wait for the SW to become active before subscribing.
    await navigator.serviceWorker.ready;

    // If forceFresh, drop any cached subscription first. The browser
    // doesn't know when the server has pruned a subscription (404/410
    // from the push service) — it just hands back whatever it cached
    // last. Without this, "toggle off + back on" keeps re-registering
    // the same dead endpoint. This is the iOS-PWA reliability fix.
    let existing = await registration.pushManager.getSubscription();
    if (existing && forceFresh) {
      try {
        await existing.unsubscribe();
      } catch (err) {
        console.warn('Web Push: unsubscribe-before-resubscribe failed', err);
      }
      existing = null;
    }

    let sub = existing;
    if (!sub) {
      try {
        sub = await registration.pushManager.subscribe({
          userVisibleOnly: true,
          // Cast to BufferSource — the DOM lib types are stricter about
          // SharedArrayBuffer-vs-ArrayBuffer than we need to be here.
          applicationServerKey: urlBase64ToUint8Array(vapidPublicKey) as BufferSource,
        });
      } catch (err) {
        console.warn('Web Push: subscribe failed', err);
        return null;
      }
    }

    return {
      token: JSON.stringify(sub.toJSON()),
      type: 'web',
    };
  }
}

function isWebPushSupported(): boolean {
  return (
    typeof globalThis !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    'serviceWorker' in navigator &&
    'PushManager' in globalThis
  );
}

// Convert a URL-safe base64 VAPID public key into the Uint8Array shape that
// PushManager.subscribe expects.
function urlBase64ToUint8Array(base64: string): Uint8Array {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4);
  const normalized = (base64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(normalized);
  const arr = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) arr[i] = raw.charCodeAt(i);
  return arr;
}
