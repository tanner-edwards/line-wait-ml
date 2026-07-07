// Hero card at the top of the ride detail sheet.
//
// Five rows, whitespace-only separation:
//   Row 1  Ride name (left)           Close ✕ (right)
//   Row 2  Location — land · park
//   Row 3  Wait number (50%)          Direction curve (50%)
//   Row 4  [Badge pill]  [Tagline]
//   Row 5  [Walk pill]                [Watch button]

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, Footprints, Star, Zap } from 'lucide-react-native';
import { colors } from '../../theme/tokens';
import { WalkPill } from '../WalkPill';
import { DirectionCurve } from './DirectionCurve';
import { Badge } from '../../types';

type TrendDir = 'up' | 'down' | 'stable' | null;

interface Props {
  rideName: string;
  parkName: string | null;
  land: string;
  isOperating: boolean;
  isDown: boolean;
  anchorWait: number | null;
  showWalkOn: boolean;
  badge: Badge;
  oneLiner: string | null;
  walkMins: number | null;
  isWatching: boolean;
  rideId: string;
  trendDir: TrendDir;
  bucket0Wait: number | null;
  bucket4Wait: number | null;
  onToggleWatch: () => void;
  hasActiveTrip: boolean;
  // State 7 — post-reopen opportunity card. Only true briefly after a break
  // closure resolves to a below-typical wait. Stubbed false until ML ships.
  postReopenWaitDrop: boolean;
  downDurationMs: number | null;
  waitAtClose: number | null;
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
  oneLiner,
  walkMins,
  isWatching,
  rideId,
  trendDir,
  bucket0Wait,
  bucket4Wait,
  onToggleWatch,
  hasActiveTrip,
  postReopenWaitDrop,
  downDurationMs,
  waitAtClose,
}: Props): React.ReactElement {
  const subtitle = [land, parkName].filter(Boolean).join(' · ');

  return (
    <View style={styles.card}>
      {/* Row 1 — Ride name */}
      <Text style={styles.rideName}>{rideName}</Text>

      {/* Row 2 — Location */}
      <Text style={styles.location}>{subtitle}</Text>

      {/* Row 3 — Wait number (50%) + Direction curve (50%) */}
      <View style={styles.row3}>
        {/* Left 50%: wait number or Walk On */}
        <View style={styles.waitSide}>
          {showWalkOn ? (
            <View style={styles.walkOnBlock}>
              <Footprints size={22} color={colors.textPrimary} />
              <Text style={styles.walkOnText}>Walk On</Text>
            </View>
          ) : isDown ? (
            <Text style={styles.closedText}>Down</Text>
          ) : anchorWait !== null ? (
            <View style={styles.waitNumberRow}>
              <Text style={styles.waitNumber}>{anchorWait}</Text>
              <Text style={styles.waitUnit}>min</Text>
            </View>
          ) : null}
        </View>

        {/* Right 50%: direction curve — only meaningful when ride is operating */}
        {isOperating ? (
          <View style={styles.curveSide}>
            <DirectionCurve
              trendDir={trendDir}
              bucket0Wait={bucket0Wait}
              bucket4Wait={bucket4Wait}
            />
          </View>
        ) : null}
      </View>

      {/* Row 4 — Badge pill + tagline */}
      <BadgeRow badge={badge} showWalkOn={showWalkOn} oneLiner={oneLiner} />

      {/* State 7 — Post-reopen opportunity card: short line after a break closure.
          Dormant (never renders) until ML populates postReopenWaitDrop. */}
      {!isDown && postReopenWaitDrop ? (
        <OpportunityCard
          anchorWait={anchorWait}
          waitAtClose={waitAtClose}
          downDurationMs={downDurationMs}
        />
      ) : null}

      {/* Row 5 — Walk pill + Watch button */}
      <View style={styles.row5}>
        <View style={styles.walkArea}>
          {walkMins != null ? <WalkPill minutes={walkMins} /> : null}
        </View>
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

// ── Badge row ─────────────────────────────────────────────────────────────────

function BadgeRow({
  badge,
  showWalkOn,
  oneLiner,
}: {
  badge: Badge;
  showWalkOn: boolean;
  oneLiner: string | null;
}): React.ReactElement | null {
  // Walk On takes precedence over badge pill; show as plain text + icon.
  if (showWalkOn) {
    return (
      <View style={styles.row4}>
        <Footprints size={13} color={colors.textSecondary} />
        <Text style={styles.tagline}>Walk-on wait right now</Text>
      </View>
    );
  }

  const pill = badgePill(badge);

  if (!pill && !oneLiner) return null;

  return (
    <View style={styles.row4}>
      {pill}
      {oneLiner ? <Text style={styles.tagline}>{oneLiner}</Text> : null}
    </View>
  );
}

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
        <Text style={[styles.badgePillText, { color: colors.go }]}>Good time to ride</Text>
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
  card: {
    // The parent Tile in RideDetailModal provides the card chrome (white bg,
    // border, rounded corners), so this inner container only needs to manage
    // internal flow.
  },

  // Row 1
  rideName: {
    fontFamily: 'Lora_600SemiBold',
    fontSize: 20,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 26,
    marginBottom: 4,
  },

  // Row 2
  location: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 14,
  },

  // Row 3
  row3: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  waitSide: {
    flex: 1,
    justifyContent: 'center',
  },
  curveSide: {
    flex: 1,
    aspectRatio: 2,
    paddingLeft: 12,
  },
  waitNumberRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 4,
  },
  waitNumber: {
    fontSize: 64,
    fontWeight: '700',
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    letterSpacing: -2.5,
    lineHeight: 64,
    includeFontPadding: false,
  },
  waitUnit: {
    fontSize: 14,
    color: colors.textTertiary,
    paddingBottom: 4,
  },
  walkOnBlock: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  walkOnText: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.textPrimary,
  },
  closedText: {
    fontSize: 22,
    fontWeight: '600',
    color: colors.textTertiary,
  },

  // Row 4
  row4: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 14,
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
  tagline: {
    fontSize: 12,
    color: colors.textSecondary,
    fontStyle: 'italic',
    flexShrink: 1,
  },

  // Row 5
  row5: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  walkArea: { flexDirection: 'row', alignItems: 'center' },
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
    // Inverse of the default Watch button: white surface, brand-green border + text.
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
