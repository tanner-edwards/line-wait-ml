// "Closure" tile — shown for currently-DOWN rides and, briefly, for rides
// that reopened in the last hour (info is decision-relevant while the crowd
// is still catching on, trivia after that).

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { formatDuration } from '../../../../../notification-copy';
import { formatHHMM, formatTimeAgo } from '../../timestamp';
import { Tile, TileLabel } from './Tile';

const INK = '#222'; // TODO: tokenize
const MUTED = '#bbb'; // TODO: tokenize

export function reopenedWithinLastHour(closedAt: string | null, durationMs: number | null): boolean {
  if (!closedAt || durationMs == null) return false;
  const reopenTime = new Date(closedAt).getTime() + durationMs;
  return Date.now() - reopenTime < 60 * 60_000;
}

interface Props {
  isDown: boolean;
  rideClosedAt: string | null;       // from ride.closedAt (live snapshot)
  notifClosedAt: string | null;      // from notification log entry
  notifDurationMs: number | null;    // from notification log entry
}

export function ClosureTile({
  isDown,
  rideClosedAt,
  notifClosedAt,
  notifDurationMs,
}: Props): React.ReactElement | null {
  // Show for currently-down rides, OR briefly after a reopen.
  if (!isDown && !reopenedWithinLastHour(notifClosedAt, notifDurationMs)) {
    return null;
  }

  return (
    <Tile>
      <TileLabel>Closure</TileLabel>
      {/* Currently-down ride: show when it closed + live duration. */}
      {isDown && rideClosedAt ? (
        <>
          <Text style={styles.closureLine}>
            Closed at <Text style={styles.bold}>{formatHHMM(rideClosedAt)}</Text>
          </Text>
          <Text style={styles.closureLine}>
            Down for <Text style={styles.bold}>{formatTimeAgo(rideClosedAt)}</Text>
          </Text>
        </>
      ) : isDown ? (
        <Text style={styles.closureLine}>Currently down.</Text>
      ) : null}
      {/* Reopened ride: show closed-at + total downtime from the log entry. */}
      {!isDown && notifClosedAt ? (
        <Text style={styles.closureLine}>
          Closed at <Text style={styles.bold}>{formatHHMM(notifClosedAt)}</Text>
        </Text>
      ) : null}
      {notifDurationMs != null ? (
        <Text style={styles.closureLine}>
          Was down for{' '}
          <Text style={styles.bold}>
            {formatDuration(notifDurationMs) ?? `${Math.round(notifDurationMs / 60_000)} min`}
          </Text>
        </Text>
      ) : null}
      {isDown ? (
        <Text style={styles.closureFutureHint}>Reopen estimate — coming soon.</Text>
      ) : null}
    </Tile>
  );
}

const styles = StyleSheet.create({
  closureLine: { fontSize: 14, color: INK },
  closureFutureHint: { fontSize: 12, color: MUTED, marginTop: 6, fontStyle: 'italic' },
  bold: { fontWeight: '700' },
});
