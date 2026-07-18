// Coordinates the notifications surface: the history sheet (list of recent
// notifications) and the ride detail modal (full-screen page for a single
// ride). Both are lifted into this single context so opening one closes
// the other cleanly — and so the detail page's "Back" button knows to
// re-open the history sheet when that's where the user came from.
//
// Source tracking:
//   • 'history'  — opened from a history-sheet row tap. Closing detail
//                  re-opens the sheet so the user lands back in their
//                  list.
//   • 'deeplink' — opened from an OS notification tap (service worker
//                  deep-link). Closing detail dismisses; user lands on
//                  whatever screen the app was on.

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { NotificationCategory, NotificationKind } from '../types';

export type DetailSource = 'history' | 'deeplink' | 'browse';

export interface ActiveDetail {
  rideId: string;
  /** Null when opened from the browse list (no associated notification). */
  type: NotificationKind | null;
  source: DetailSource;
  /** Downtime in ms — present on reopen notifications, null otherwise. */
  durationMs?: number | null;
  /** ISO timestamp of when the ride closed — from the reopen log entry. */
  closedAt?: string | null;
  /** LLM-generated note when a persona factor (age, pregnancy, etc.) affected ranking. */
  restrictionNote?: string | null;
  /** AI one-liner from the recommendations page, if the detail was opened from there. */
  oneLiner?: string | null;
}

interface NotificationDetailContextValue {
  active: ActiveDetail | null;
  historySheetOpen: boolean;
  historySheetPreFilter: NotificationCategory | null;
  openHistorySheet: (preFilter?: NotificationCategory) => void;
  closeHistorySheet: () => void;
  openDetail: (detail: ActiveDetail) => void;
  closeDetail: () => void;
  dismissAll: () => void;
}

const NotificationDetailContext = createContext<NotificationDetailContextValue | null>(null);

export function NotificationDetailProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ActiveDetail | null>(null);
  const [historySheetOpen, setHistorySheetOpen] = useState(false);
  const [historySheetPreFilter, setHistorySheetPreFilter] = useState<NotificationCategory | null>(null);

  const openHistorySheet = useCallback((preFilter?: NotificationCategory) => {
    setHistorySheetPreFilter(preFilter ?? null);
    setHistorySheetOpen(true);
  }, []);
  const closeHistorySheet = useCallback(() => {
    setHistorySheetOpen(false);
    setHistorySheetPreFilter(null);
  }, []);

  const openDetail = useCallback((detail: ActiveDetail) => {
    // Sheet stays open underneath — the detail modal is mounted after
    // the sheet in App.tsx so it renders on top, and leaving the sheet
    // open means Back from the detail naturally reveals it again with
    // no extra coordination. For deep-link entries we also open the
    // sheet explicitly (see NotificationDeepLinkHandler) so the user
    // lands in the same in-app state regardless of how they got here.
    setActive(detail);
  }, []);

  const closeDetail = useCallback(() => {
    setActive(prev => {
      // If we came from the history sheet, restore it on the way out.
      // Deep-link entries just dismiss to whatever screen was underneath.
      if (prev?.source === 'history') setHistorySheetOpen(true);
      return null;
    });
  }, []);

  const dismissAll = useCallback(() => {
    setActive(null);
    setHistorySheetOpen(false);
  }, []);

  const value = useMemo(
    () => ({
      active,
      historySheetOpen,
      historySheetPreFilter,
      openHistorySheet,
      closeHistorySheet,
      openDetail,
      closeDetail,
      dismissAll,
    }),
    [active, historySheetOpen, historySheetPreFilter, openHistorySheet, closeHistorySheet, openDetail, closeDetail, dismissAll]
  );

  return (
    <NotificationDetailContext.Provider value={value}>
      {children}
    </NotificationDetailContext.Provider>
  );
}

export function useNotificationDetail(): NotificationDetailContextValue {
  const ctx = useContext(NotificationDetailContext);
  if (!ctx) throw new Error('useNotificationDetail must be used inside <NotificationDetailProvider>');
  return ctx;
}
