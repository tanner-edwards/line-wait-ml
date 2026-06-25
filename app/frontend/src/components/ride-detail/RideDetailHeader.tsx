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
import { Bell, Footprints, Star } from 'lucide-react-native';
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
}

const BRAND = colors.brand;
const INK   = '#222';
const SUBINK = '#666';

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
              <Footprints size={22} color={INK} />
              <Text style={styles.walkOnText}>Walk On</Text>
            </View>
          ) : isDown ? (
            <Text style={styles.closedText}>Closed</Text>
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
        <Footprints size={13} color={SUBINK} />
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
    color: INK,
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
    color: INK,
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
    color: INK,
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
});
