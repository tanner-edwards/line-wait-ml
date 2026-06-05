// Non-rendering component that listens for two notification-tap signals:
//
//   1. On launch: `?notif=<rideId>__<type>` in the URL (the service worker
//      opens the app with this query string when the user taps an OS
//      notification while the app is closed).
//   2. While running: a 'message' from the service worker carrying the
//      same rideId/type pair (the user tapped an OS notification while
//      the app tab was already open — the SW focuses the tab and posts
//      the message instead of reopening).
//
// Both pathways resolve to the same NotificationDetailContext.openDetail
// call, which lifts the modal at the root.

import { useEffect } from 'react';
import { useNotificationDetail } from '../context/NotificationDetailContext';
import { NotificationKind } from '../types';

const VALID_KINDS: readonly NotificationKind[] = ['trough', 'closure', 'reopen'];

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
    if (typeof window === 'undefined' || !window.location?.search) return;
    const params = new URLSearchParams(window.location.search);
    const detail = parseNotifParam(params.get('notif'));
    if (detail) {
      // Open the history sheet first so it's visible underneath the
      // detail modal. Tapping Back on the detail then reveals the
      // sheet — same end-state as if the user had opened the sheet
      // themselves and tapped the row.
      openHistorySheet();
      openDetail({ ...detail, source: 'history' });
      // Strip the param so a page reload doesn't keep re-opening the modal.
      params.delete('notif');
      const next = params.toString();
      const url = window.location.pathname + (next ? `?${next}` : '') + window.location.hash;
      window.history.replaceState(null, '', url);
    }
  }, [openDetail, openHistorySheet]);

  // 2. Service-worker message channel — for taps while the app tab is open.
  useEffect(() => {
    if (typeof navigator === 'undefined' || !('serviceWorker' in navigator)) return;
    const handler = (event: MessageEvent) => {
      const data = event.data as { kind?: string; rideId?: string; type?: string } | null;
      if (!data || data.kind !== 'notification-click') return;
      const detail = parseNotifParam(`${data.rideId ?? ''}__${data.type ?? ''}`);
      if (detail) {
        openHistorySheet();
        openDetail({ ...detail, source: 'history' });
      }
    };
    navigator.serviceWorker.addEventListener('message', handler);
    return () => navigator.serviceWorker.removeEventListener('message', handler);
  }, [openDetail, openHistorySheet]);

  return null;
}
