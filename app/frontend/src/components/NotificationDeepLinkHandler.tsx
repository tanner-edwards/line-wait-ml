// Non-rendering component that listens for three notification-tap signals:
//
//   1. On launch: `?notif=<rideId>__<type>` in the URL (the service worker
//      opens the app with this query string when the user taps an OS
//      notification while the app is closed).
//   2. While running: a 'message' from the service worker carrying the
//      same rideId/type pair (the user tapped an OS notification while
//      the app tab was already open — the SW focuses the tab and posts
//      the message instead of reopening).
//   3. Native iOS/Android: Expo's addNotificationResponseReceivedListener
//      fires when the user taps an OS notification while the app is in the
//      background. Payload data comes from scanner.js sendExpoPush.
//
// All three pathways resolve to the same NotificationDetailContext.openDetail
// call, which lifts the modal at the root.

import { useEffect } from 'react';
import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { NotificationKind } from '../types';
import { logInfo, logWarn } from '../utils/logger';

const VALID_KINDS: readonly NotificationKind[] = ['trough', 'closure', 'reopen', 'peak'];

function parseNotifParam(value: string | null): { rideId: string; type: NotificationKind } | null {
  if (!value) return null;
  const [rideId, type] = value.split('__');
  if (!rideId || !type) return null;
  if (!(VALID_KINDS as readonly string[]).includes(type)) return null;
  return { rideId, type: type as NotificationKind };
}

export function NotificationDeepLinkHandler(): null {
  const { openDetail, openHistorySheet } = useNotificationDetail();

  // 1. Launch-time URL param check (PWA only — RN native ignores).
  useEffect(() => {
    if (typeof window === 'undefined' || !window.location?.search) {
      logInfo(`deeplink/url: no search string (url="${typeof window !== 'undefined' ? window.location?.href : 'no window'}")`, 'deeplink');
      return;
    }
    const params = new URLSearchParams(window.location.search);
    const raw = params.get('notif');
    logInfo(`deeplink/url: search="${window.location.search}" notif param="${raw ?? '(none)'}"`, 'deeplink');
    const detail = parseNotifParam(raw);
    if (detail) {
      logInfo(`deeplink/url: opening detail rideId=${detail.rideId} type=${detail.type}`, 'deeplink');
      openHistorySheet();
      openDetail({ ...detail, source: 'history' });
      params.delete('notif');
      const next = params.toString();
      const url = window.location.pathname + (next ? `?${next}` : '') + window.location.hash;
      window.history.replaceState(null, '', url);
    } else if (raw) {
      logWarn(`deeplink/url: notif param present but failed to parse: "${raw}"`, 'deeplink');
    }
  }, [openDetail, openHistorySheet]);

  // 2. Service-worker message channel — for taps while the app tab is open.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) {
      logWarn('deeplink/sw: serviceWorker not available', 'deeplink');
      return;
    }
    logInfo('deeplink/sw: message listener registered', 'deeplink');
    const handler = (event: MessageEvent) => {
      const data = event.data as { kind?: string; rideId?: string; type?: string } | null;
      logInfo(`deeplink/sw: message received kind="${data?.kind ?? '(none)'}" rideId="${data?.rideId ?? ''}" type="${data?.type ?? ''}"`, 'deeplink');
      if (!data || data.kind !== 'notification-click') return;
      const detail = parseNotifParam(`${data.rideId ?? ''}__${data.type ?? ''}`);
      if (detail) {
        logInfo(`deeplink/sw: opening detail rideId=${detail.rideId} type=${detail.type}`, 'deeplink');
        openHistorySheet();
        openDetail({ ...detail, source: 'history' });
      } else {
        logWarn(`deeplink/sw: notification-click message but failed to parse rideId/type`, 'deeplink');
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [openDetail, openHistorySheet]);

  // 3. Native push tap (iOS/Android only) — Expo notification response listener.
  useEffect(() => {
    if (Platform.OS === 'web') return;

    const subscription = Notifications.addNotificationResponseReceivedListener(response => {
      const data = response.notification.request.content.data as {
        rideId?: string;
        type?: string;
      } | null;
      logInfo(`deeplink/native: tap received rideId="${data?.rideId ?? ''}" type="${data?.type ?? ''}"`, 'deeplink');
      if (!data?.rideId) {
        logWarn('deeplink/native: notification tap missing rideId', 'deeplink');
        return;
      }
      const type = (VALID_KINDS as readonly string[]).includes(data.type ?? '')
        ? (data.type as NotificationKind)
        : null;
      openDetail({ rideId: data.rideId, type, source: 'deeplink' });
    });

    return () => subscription.remove();
  }, [openDetail]);

  return null;
}
