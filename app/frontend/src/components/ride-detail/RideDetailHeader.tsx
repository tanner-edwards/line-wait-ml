// Top of the ride detail page — name + close button, badge pill, location
// + wait number with trend direction, walk pill + watch/notify button.
//
// Pure props. The parent (DetailBody in RideDetailModal) builds every
// value passed in — including the precomputed badge precedence,
// wait color, and trend label — so this stays a renderer.

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, Footprints, Star, X } from 'lucide-react-native';
import { colors } from '../../theme/tokens';
import { WalkPill } from '../WalkPill';
import { Badge } from '../../types';

const BRAND = colors.brand;
const MUTED = '#bbb'; // TODO: tokenize
const INK = '#222'; // TODO: tokenize
const SUBINK = '#666'; // TODO: tokenize

interface Props {
  rideName: string;
  parkName: string | null;
  land: string;
  isDown: boolean;
  anchorWait: number | null;
  waitColor: string;
  showWalkOn: boolean;
  badge: Badge;
  trendLabel: string | null;
  trendColor: string;
  walkMins: number | null;
  isWatching: boolean;
  rideId: string;
  oneLiner: string | null;
  onToggleWatch: () => void;
  onDismissAll: () => void;
}

export function RideDetailHeader({
  rideName,
  parkName,
  land,
  isDown,
  anchorWait,
  waitColor,
  showWalkOn,
  badge,
  trendLabel,
  trendColor,
  walkMins,
  isWatching,
  rideId,
  oneLiner,
  onToggleWatch,
  onDismissAll,
}: Props): React.ReactElement {
  return (
    <View style={styles.headerBlock}>
      {/* Row 1: ride name + close */}
      <View style={styles.nameCloseRow}>
        <Text style={styles.rideName}>{rideName}</Text>
        <Pressable
          onPress={onDismissAll}
          hitSlop={12}
          testID="ride-detail-dismiss"
          style={styles.closeBtn}
        >
          <X size={18} color={colors.textSecondary} />
        </Pressable>
      </View>

      {/* Rows 2+3: left column (badge + location) and right column (wait) are independent */}
      <View style={styles.midRow}>
        <View style={styles.leftCol}>
          {badge === 'star' ? (
            <View style={[styles.badgePill, { backgroundColor: colors.starBg }]}>
              <Star size={12} color={colors.star} fill={colors.star} />
              <Text style={[styles.badgePillText, { color: colors.star }]}>Rare find</Text>
            </View>
          ) : badge === 'go' ? (
            <View style={[styles.badgePill, { backgroundColor: colors.goBg }]}>
              <Text style={[styles.badgePillText, { color: colors.go }]}>Good time to ride</Text>
            </View>
          ) : badge === 'skip' ? (
            <View style={[styles.badgePill, { backgroundColor: colors.skipBg }]}>
              <Text style={[styles.badgePillText, { color: colors.skip }]}>Busier than usual</Text>
            </View>
          ) : null}
          <Text style={styles.subtitle}>
            {land}{parkName ? ` · ${parkName}` : ''}
          </Text>
        </View>
        <View style={styles.waitRight}>
          {showWalkOn ? (
            <View style={styles.walkOnWaitRow}>
              <Footprints size={14} color={colors.textSecondary} />
              <Text style={styles.walkOnWaitText}>Walk On</Text>
            </View>
          ) : isDown ? (
            <View style={styles.waitStack}>
              <Text style={styles.closedLabel}>Closed</Text>
              {anchorWait !== null ? (
                <Text style={styles.closedAnnotation}>{anchorWait} min at close</Text>
              ) : null}
            </View>
          ) : anchorWait !== null ? (
            <View style={styles.waitStack}>
              <View style={styles.waitNumberInline}>
                <Text style={[styles.waitBig, { color: waitColor }]}>{anchorWait}</Text>
                <Text style={styles.waitUnit}> min</Text>
              </View>
              {trendLabel ? (
                <Text style={[styles.trendText, { color: trendColor }]}>{trendLabel}</Text>
              ) : null}
            </View>
          ) : null}
        </View>
      </View>

      {/* Row 4: walk time (left) + notify (right) */}
      <View style={styles.walkNotifyRow}>
        <View style={styles.walkTimeArea}>
          {walkMins != null ? <WalkPill minutes={walkMins} /> : null}
        </View>
        <Pressable
          onPress={onToggleWatch}
          style={[styles.notifyBtn, isWatching && styles.notifyBtnWatching]}
          hitSlop={8}
          testID={`detail-bell-${rideId}`}
          accessibilityRole="button"
          accessibilityLabel={isWatching ? 'Remove alert' : 'Set alert'}
        >
          <Bell size={14} color={isWatching ? colors.star : colors.textInverse} />
          <Text style={[styles.notifyBtnText, isWatching && styles.notifyBtnWatchingText]}>
            {isWatching ? 'Watching' : 'Watch'}
          </Text>
        </Pressable>
      </View>

      {oneLiner ? (
        <Text style={styles.oneLiner}>{oneLiner}</Text>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  headerBlock: {
    marginBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
    paddingBottom: 12,
  },
  nameCloseRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 4,
  },
  rideName: {
    fontFamily: 'Lora_600SemiBold',
    fontSize: 20,
    fontWeight: '600',
    color: INK,
    lineHeight: 26,
    flex: 1,
    marginRight: 12,
  },
  closeBtn: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
    marginTop: 2,
  },
  badgePill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 100,
    marginBottom: 4,
  },
  badgePillText: { fontSize: 12, fontWeight: '600' },
  midRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  leftCol: { flex: 1, marginRight: 12 },
  subtitle: { fontSize: 13, color: SUBINK, marginTop: 2 },
  waitRight: { alignItems: 'flex-end', flexShrink: 0 },
  waitNumberInline: { flexDirection: 'row', alignItems: 'baseline' },
  waitBig: {
    fontSize: 36,
    fontWeight: '700',
    fontFamily: 'Outfit_700Bold',
    color: INK,
    fontVariant: ['tabular-nums'],
    letterSpacing: -0.72,
    lineHeight: 36,
  },
  waitUnit: { fontSize: 12, color: SUBINK, marginLeft: 2 },
  walkOnWaitRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  walkOnWaitText: { fontSize: 13, color: SUBINK },
  waitStack: { alignItems: 'flex-end', gap: 2 },
  closedLabel: { fontSize: 15, fontWeight: '600', color: MUTED },
  closedAnnotation: { fontSize: 11, color: MUTED, textAlign: 'right' },
  trendText: { fontSize: 12.5, fontWeight: '600' },
  walkNotifyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: 2,
  },
  walkTimeArea: { flexDirection: 'row', alignItems: 'center' },
  notifyBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
    paddingHorizontal: 14,
    paddingVertical: 7,
    borderRadius: 100,
    backgroundColor: BRAND,
  },
  notifyBtnWatching: {
    backgroundColor: 'transparent',
    borderWidth: 1,
    borderColor: colors.borderStrong,
  },
  notifyBtnText: { fontSize: 13, fontWeight: '600', color: colors.textInverse },
  notifyBtnWatchingText: { color: colors.textSecondary, fontWeight: '500' },
  oneLiner: {
    fontSize: 13,
    color: colors.textSecondary,
    fontStyle: 'italic',
    lineHeight: 18,
    marginTop: 10,
  },
});
