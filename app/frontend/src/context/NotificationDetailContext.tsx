// Lightweight state holder for the active "view this notification's
// detail" modal. Two consumers open the modal — the history-sheet row
// taps and the service-worker deep-link handler — so we lift the state
// above both and render the modal once at the root.

import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';
import { NotificationKind } from '../types';

export interface ActiveDetail {
  rideId: string;
  type: NotificationKind;
}

interface NotificationDetailContextValue {
  active: ActiveDetail | null;
  openDetail: (detail: ActiveDetail) => void;
  closeDetail: () => void;
}

const NotificationDetailContext = createContext<NotificationDetailContextValue | null>(null);

export function NotificationDetailProvider({ children }: { children: React.ReactNode }) {
  const [active, setActive] = useState<ActiveDetail | null>(null);
  const openDetail = useCallback((detail: ActiveDetail) => setActive(detail), []);
  const closeDetail = useCallback(() => setActive(null), []);
  const value = useMemo(() => ({ active, openDetail, closeDetail }), [active, openDetail, closeDetail]);
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
