// Hero card at the top of the ride detail sheet (phase-4 redesign).
//
//   [Ride icon] │ Ride name
//               │ Land · Park                      [walk pill]
//   ┌ Verdict banner: icon + RARE FIND / GOOD TIME TO RIDE / SKIP FOR NOW ┐
//   └ deterministic why-line                                             ┘
//   [Post-reopen opportunity card — dormant until ML ships]
//   ┌─ white card (everything above sits on the sheet's cream) ─────────
//   (clock) Current Wait   │  (arrow) Predicted Trend
//           75 min         │          Rising
//   Today's Range bar — full width   (gated: paid + operating only)
//   ─────────────────────────────────────────────────────────────────
//                                                   [Watch]
//
// The verdict banner is the ONLY colored signal; the trend icon stays gray so
// it can't contradict it (a green wait next to a red "Rising").

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ArrowRight,
  Bell,
  CheckCircle,
  Clock,
  Footprints,
  OctagonX,
  Star,
  TrendingDown,
  TrendingUp,
  Zap,
} from 'lucide-react-native';
import { colors, spacing, typography } from '../../theme/tokens';
import { WalkPill } from '../WalkPill';
import { RideIcon } from '../icons/RideIcon';
import { TodaysRange } from './TodaysRange';
import { Tile } from './Tile';
import { Badge } from '../../types';

type TrendDir = 'up' | 'down' | 'stable' | null;

// Vertical dividers + the rule above Watch — darker than colors.border so
// they read on both cream and white.
const DIVIDER = 'rgba(10,107,90,0.28)';

const DIRECTION: Record<'up' | 'down' | 'stable', { label: string; Icon: typeof TrendingUp }> = {
  up: { label: 'Rising', Icon: TrendingUp },
  down: { label: 'Dropping', Icon: TrendingDown },
  stable: { label: 'Steady', Icon: ArrowRight },
};

// Banner per verdict. Titles blend the mockup's call-to-action tone with the
// earlier pill copy. Backgrounds are solid hexes (badge color on white) so
// the sheet's cream can't show through — same values ReasonCard used.
const VERDICT_BANNER: Record<'star' | 'go' | 'skip', { title: string; color: string; bg: string; border: string; Icon: typeof Star }> = {
  star: { title: 'RARE FIND', color: colors.star, bg: '#F3E8CD', border: colors.starBorder, Icon: Star },
  go: { title: 'GOOD TIME TO RIDE', color: colors.go, bg: '#E6EDEB', border: colors.goBorder, Icon: CheckCircle },
  skip: { title: 'SKIP FOR NOW', color: colors.skip, bg: '#F8EBEA', border: colors.skipBorder, Icon: OctagonX },
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
  /** Deterministic verdict "why" — the banner's sentence. */
  whyText: string | null;
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
  /** Extra content at the bottom of the white card (e.g. restriction note). */
  children?: React.ReactNode;
}

export function RideDetailHeader({
  rideName,
  parkName,
  land,
  isOperating,
  isDown,
  anchorWait,
  showWalkOn,
  badge,
  whyText,
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
  children,
}: Props): React.ReactElement {
  const subtitle = [land, parkName].filter(Boolean).join(' · ');
  const showRangeBar = hasActiveTrip && !isDown && rideStats != null;
  const banner = badge && badge !== 'caution' ? VERDICT_BANNER[badge] : null;
  const direction = trendDir && !isDown ? DIRECTION[trendDir] : null;

  const waitValue = showWalkOn
    ? 'Walk On'
    : isDown
    ? 'Down'
    : anchorWait !== null
    ? `${anchorWait} min`
    : '—';

  return (
    <View>
      {/* Identity — icon │ name + location */}
      <View style={styles.identity}>
        <RideIcon rideId={rideId} size={56} />
        <View style={styles.identityDivider} />
        <View style={styles.identityText}>
          <Text style={styles.rideName}>{rideName}</Text>
          <View style={styles.locationRow}>
            <Text style={styles.location}>{subtitle}</Text>
            {walkMins != null ? <WalkPill minutes={walkMins} /> : null}
          </View>
        </View>
      </View>

      {/* Verdict banner — omitted for neutral / caution */}
      {banner ? (
        <View style={[styles.banner, { backgroundColor: banner.bg, borderColor: banner.border }]} testID={`detail-verdict-${badge}`}>
          <banner.Icon
            size={36}
            color={banner.color}
            fill={badge === 'star' ? banner.color : 'none'}
            strokeWidth={2}
          />
          <View style={styles.bannerText}>
            <Text style={[styles.bannerTitle, { color: banner.color }]}>{banner.title}</Text>
            {whyText ? <Text style={styles.bannerBody}>{whyText}</Text> : null}
          </View>
        </View>
      ) : null}

      {!isDown && postReopenWaitDrop ? (
        <OpportunityCard
          anchorWait={anchorWait}
          waitAtClose={waitAtClose}
          downDurationMs={downDurationMs}
        />
      ) : null}

      <Tile style={styles.card}>
        {/* Stats — Current Wait │ Predicted Trend (trend column omitted when null) */}
        <View style={styles.stats}>
          <View style={styles.stat}>
            {showWalkOn ? (
              <Footprints size={26} color={colors.textPrimary} />
            ) : (
              <Clock size={26} color={colors.textPrimary} />
            )}
            <View>
              <Text style={styles.statLabel}>Current Wait</Text>
              <Text style={[styles.statValue, isDown && styles.statValueDown]}>{waitValue}</Text>
            </View>
          </View>
          {direction ? (
            <>
              <View style={styles.statDivider} />
              <View style={styles.stat}>
                <direction.Icon size={26} color={colors.textTertiary} />
                <View>
                  <Text style={styles.statLabel}>Predicted Trend</Text>
                  <Text style={styles.statValue}>{direction.label}</Text>
                </View>
              </View>
            </>
          ) : null}
        </View>

        {/* Today's Range bar (paid + operating only) */}
        {showRangeBar ? (
          <View style={styles.rangeBarContainer}>
            <TodaysRange
              p10={rideStats!.p10}
              p90={rideStats!.p90}
              current={anchorWait}
              typicalWait={bucket0Wait}
              badge={badge}
            />
          </View>
        ) : null}

        {/* Watch button, right-aligned. The mockup's bottom Watch / Set
            Reminder bar is a later phase. */}
        <View style={styles.watchRow}>
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
        {children}
      </Tile>
    </View>
  );
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
  // Identity
  identity: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginBottom: spacing.base,
  },
  identityDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: DIVIDER,
  },
  identityText: { flex: 1 },
  rideName: {
    fontFamily: 'Lora_600SemiBold',
    fontSize: 24,
    fontWeight: '600',
    color: colors.textPrimary,
    lineHeight: 30,
  },
  locationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginTop: 2,
  },
  location: {
    ...typography.label,
    fontSize: 13,
    color: colors.go,
    flexShrink: 1,
  },

  // Verdict banner
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.base,
    borderRadius: 14,
    borderWidth: 1,
    marginBottom: spacing.base,
  },
  bannerText: { flex: 1 },
  bannerTitle: {
    fontFamily: 'Outfit_700Bold',
    fontSize: 20,
    fontWeight: '700',
    letterSpacing: 0.4,
  },
  bannerBody: {
    ...typography.body,
    color: colors.textPrimary,
    marginTop: 2,
  },

  // White card starts at the stats row; identity + banner sit on cream.
  card: { marginTop: 0 },

  // Stats
  stats: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: spacing.sm,
  },
  stat: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
  },
  statDivider: {
    width: 1,
    alignSelf: 'stretch',
    backgroundColor: DIVIDER,
    marginHorizontal: spacing.md,
  },
  statLabel: {
    ...typography.label,
    color: colors.textSecondary,
  },
  statValue: {
    fontFamily: 'Lora_700Bold',
    fontSize: 24,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  statValueDown: { color: colors.textTertiary },

  // Range bar
  rangeBarContainer: {
    marginTop: spacing.base,
    marginBottom: 4,
  },

  // Watch
  watchRow: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    borderTopWidth: 1,
    borderTopColor: DIVIDER,
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
    backgroundColor: colors.brand,
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
