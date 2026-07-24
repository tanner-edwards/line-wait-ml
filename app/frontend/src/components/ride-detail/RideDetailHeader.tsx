// Hero card — "Stacked-Center" layout.
//
// Seven rows, whitespace-only separation except one hairline above Row 7:
//   Row 1  Ride name (left)
//   Row 2  Location (left)                Walk pill (right)
//   Row 3  [Badge — centered, omitted if none]
//   Row 4  Wait number — centered, dominant  (or "Walk On" / "Down")
//   Row 5  Direction label — centered, quiet  (omitted if trendDir null)
//   Row 6  Today's Range bar — full width  (gated: paid + operating only)
//   ─────────────────────────────────────────────────────────────────
//   Row 7  Watch button — right-aligned, alone

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { AlertTriangle, Bell, CheckCircle, Footprints, Star, Zap } from 'lucide-react-native';
import { colors } from '../../theme/tokens';
import { WalkPill } from '../WalkPill';
import { TodaysRange } from './TodaysRange';
import { Badge } from '../../types';

type TrendDir = 'up' | 'down' | 'stable' | null;

const DIRECTION_LABEL: Record<'up' | 'down' | 'stable', string> = {
  up: '↗ Rising',
  down: '↘ Dropping',
  stable: '→ Steady',
};

interface Props {
  rideName: string;
  parkName: string | null;
  land: string;
  isOperating: boolean;
  isDown: boolean;
  anchorWait: number | null;
  showWalkOn: boolean;
  badge: Badge;
  walkMins: number | null;
  isWatching: boolean;
  rideId: string;
  trendDir: TrendDir;
  bucket0Wait: number | null;
  hasActiveTrip: boolean;
  rideStats: { p10: number; p90: number } | null;
  // State 7 — post-reopen opportunity card. Only true briefly after a break
  // closure resolves to a below-typical wait. Stubbed false until ML ships.
  postReopenWaitDrop: boolean;
  downDurationMs: number | null;
  waitAtClose: number | null;
  onToggleWatch: () => void;
}

const BRAND = colors.brand;

export function RideDetailHeader({
  rideName,
  parkName,
  land,
  isOperating,
  isDown,
  anchorWait,
  showWalkOn,
  badge,
  walkMins,
  isWatching,
  rideId,
  trendDir,
  bucket0Wait,
  hasActiveTrip,
  rideStats,
  postReopenWaitDrop,
  downDurationMs,
  waitAtClose,
  onToggleWatch,
}: Props): React.ReactElement {
  const subtitle = [land, parkName].filter(Boolean).join(' · ');
  const showRangeBar = hasActiveTrip && !isDown && rideStats != null;

  return (
    <View style={styles.card}>
      {/* Row 1 — Ride name */}
      <Text style={styles.rideName}>{rideName}</Text>

      {/* Row 2 — Location + walk pill */}
      <View style={styles.row2}>
        <Text style={styles.location}>{subtitle}</Text>
        {walkMins != null ? <WalkPill minutes={walkMins} /> : null}
      </View>

      {/* Row 3 — Badge, centered (omitted when no badge) */}
      {badge ? (
        <View style={styles.row3}>
          {badgePill(badge)}
        </View>
      ) : null}

      {/* State 7 — Post-reopen opportunity card: short line after a break closure.
          Dormant (never renders) until ML populates postReopenWaitDrop. */}
      {!isDown && postReopenWaitDrop ? (
        <OpportunityCard
          anchorWait={anchorWait}
          waitAtClose={waitAtClose}
          downDurationMs={downDurationMs}
        />
      ) : null}

      {/* Row 4 — Wait number (centered, dominant) */}
      <View style={styles.row4}>
        {showWalkOn ? (
          <View style={styles.walkOnBlock}>
            <Footprints size={24} color={colors.textPrimary} />
            <Text style={styles.walkOnText}>Walk On</Text>
          </View>
        ) : isDown ? (
          <Text style={styles.downText}>Down</Text>
        ) : anchorWait !== null ? (
          <View style={styles.waitNumberRow}>
            <Text style={styles.waitUnitSpacer}>min</Text>
            <Text style={styles.waitNumber}>{anchorWait}</Text>
            <Text style={styles.waitUnit}>min</Text>
          </View>
        ) : null}
      </View>

      {/* Row 5 — Direction label (centered, quiet; omitted when trendDir null or down) */}
      {trendDir && !isDown ? (
        <Text style={[styles.directionLabel, showRangeBar ? styles.directionLabelWithBar : styles.directionLabelNoBar]}>
          {DIRECTION_LABEL[trendDir]}
        </Text>
      ) : null}

      {/* Row 6 — Today's Range bar (paid + operating only, no label) */}
      {showRangeBar ? (
        <View style={styles.rangeBarContainer}>
          <TodaysRange
            p10={rideStats!.p10}
            p90={rideStats!.p90}
            current={anchorWait}
            typicalWait={bucket0Wait}
          />
        </View>
      ) : null}

      {/* Row 7 — Watch button, right-aligned, alone */}
      <View style={styles.row7}>
        <Pressable
          onPress={onToggleWatch}
          style={[styles.watchBtn, isWatching && styles.watchBtnWatching]}
          hitSlop={8}
          testID={`detail-bell-${rideId}`}
          accessibilityRole="button"
          accessibilityLabel={isWatching ? 'Remove from watchlist' : 'Add to watchlist'}
        >
          {hasActiveTrip && (
            <Bell size={14} color={isWatching ? colors.star : colors.textInverse} fill={isWatching ? colors.star : 'none'} />
          )}
          <Text style={[styles.watchBtnText, isWatching && styles.watchBtnWatchingText]}>
            {isWatching ? 'Watching' : 'Watch'}
          </Text>
        </Pressable>
      </View>
    </View>
  );
}

// ── Badge pill ─────────────────────────────────────────────────────────────────

function badgePill(badge: Badge): React.ReactElement | null {
  if (!badge) return null;
  if (badge === 'star') {
    return (
      <View style={[styles.badgePill, { backgroundColor: colors.starBg }]}>
        <Star size={12} color={colors.star} fill={colors.star} />
        <Text style={[styles.badgePillText, { color: colors.star }]}>Rare find</Text>
      </View>
    );
  }
  if (badge === 'go') {
    return (
      <View style={[styles.badgePill, { backgroundColor: colors.goBg }]}>
        <CheckCircle size={11} color={colors.go} />
        <Text style={[styles.badgePillText, { color: colors.go }]}>Good time to ride</Text>
      </View>
    );
  }
  if (badge === 'caution') {
    return (
      <View style={[styles.badgePill, { backgroundColor: colors.cautionBg }]}>
        <AlertTriangle size={11} color={colors.caution} fill={colors.caution} />
        <Text style={[styles.badgePillText, { color: colors.textSecondary }]}>Running high</Text>
      </View>
    );
  }
  if (badge === 'skip') {
    return (
      <View style={[styles.badgePill, { backgroundColor: colors.skipBg }]}>
        <Text style={[styles.badgePillText, { color: colors.skip }]}>Busier than usual</Text>
      </View>
    );
  }
  return null;
}

// ── Opportunity card (State 7) ────────────────────────────────────────────────

function formatDuration(ms: number): string {
  const min = Math.round(ms / 60_000);
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  const m = min % 60;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
}

function OpportunityCard({
  anchorWait,
  waitAtClose,
  downDurationMs,
}: {
  anchorWait: number | null;
  waitAtClose: number | null;
  downDurationMs: number | null;
}): React.ReactElement {
  const durationText = downDurationMs != null ? formatDuration(downDurationMs) : null;
  const dropText =
    waitAtClose != null && anchorWait != null
      ? `Wait dropped from ${waitAtClose} → ${anchorWait} min.`
      : anchorWait != null
      ? `Now at ${anchorWait} min.`
      : null;

  return (
    <View style={styles.opportunityCard}>
      <Zap size={14} color={colors.opportunityCardText} style={styles.opportunityIcon} />
      <View style={styles.opportunityBody}>
        <Text style={styles.opportunityTitle}>Short line right now</Text>
        <Text style={styles.opportunityDesc}>
          {durationText ? `Was down ${durationText} — just reopened. ` : 'Just reopened. '}
          {dropText ? `${dropText} ` : ''}
          Window won't last long.
        </Text>
      </View>
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  card: {},

  // Row 1
  rideName: {
    fontFamily: 'Lora_600SemiBold',
    fontSize: 24,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 30,
    marginBottom: 6,
  },

  // Row 2
  row2: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 24,
  },
  location: {
    fontSize: 11,
    color: colors.textTertiary,
    flexShrink: 1,
    marginRight: 8,
  },

  // Row 3
  row3: {
    alignItems: 'center',
    marginBottom: 12,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
  },
  badgePillText: { fontSize: 12, fontWeight: '600' },

  // Row 4
  row4: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  waitNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
  },
  waitNumber: {
    fontSize: 80,
    fontWeight: '500',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    letterSpacing: -6,
    lineHeight: 88,
    paddingRight: 6,
  },
  waitUnit: {
    fontSize: 15,
    letterSpacing: 0,
    color: colors.textTertiary,
    marginLeft: 8,
  },
  waitUnitSpacer: {
    fontSize: 15,
    marginRight: 8,
    paddingLeft: 6,
    opacity: 0,
  },
  walkOnBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  walkOnText: {
    fontSize: 38,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  downText: {
    fontSize: 48,
    fontWeight: '500',
    color: colors.textTertiary,
    fontVariant: ['tabular-nums'],
    letterSpacing: 0,
    lineHeight: 80,
    includeFontPadding: false,
  },

  // Row 5
  directionLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: colors.textTertiary,
    textAlign: 'center',
  },
  // When range bar follows, add generous gap so the two read as distinct.
  directionLabelWithBar: { marginTop: 8, marginBottom: 28 },
  // When no range bar, smaller gap before the divider.
  directionLabelNoBar: { marginTop: 8, marginBottom: 0 },

  // Row 6
  rangeBarContainer: {
    marginBottom: 4,
  },

  // Row 7
  row7: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: 'rgba(10,107,90,0.07)',
    paddingTop: 12,
    marginTop: 14,
  },
  watchBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: BRAND,
  },
  watchBtnWatching: {
    backgroundColor: colors.surface,
    borderWidth: 1.5,
    borderColor: colors.brand,
  },
  watchBtnText: { fontSize: 13, fontWeight: '600', color: colors.textInverse },
  watchBtnWatchingText: { color: colors.brand, fontWeight: '600' },

  // State 7 — opportunity card
  opportunityCard: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 8,
    marginBottom: 12,
    padding: 10,
    backgroundColor: colors.opportunityCardBg,
    borderRadius: 11,
    borderWidth: 1.5,
    borderColor: colors.opportunityCardBorder,
  },
  opportunityIcon: { marginTop: 1 },
  opportunityBody: { flex: 1 },
  opportunityTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: colors.opportunityCardText,
    marginBottom: 2,
  },
  opportunityDesc: {
    fontSize: 11,
    color: colors.textSecondary,
    lineHeight: 16,
  },
});
