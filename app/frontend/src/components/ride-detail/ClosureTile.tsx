// Closure Intelligence card — shown while a ride is DOWN.
//
// State machine (paid + high confidence):
//   blip-early       elapsed ≤ 75% of blipEst   gray bar, no notify
//   blip-approaching elapsed ≤ blipEst (>75%)   teal bar, no notify
//   break-shifted    elapsed > blipEst (blip→break) gold, ghost tick, notify
//   break-origin     closureType='break' from start  gold, ghost tick, notify
//   past-break       elapsed > breakEst          red overflow, notify
//
// State 5 (additive on break states): predictedReopenWait != null → green
// sub-card above secondary copy.
//
// Free tier (State 1): "Closed at X" + lock icon + unlock CTA, no bar.
// Suppressed / no profile: timer-only (no bar, no estimate).

import React from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Bell, Lock } from 'lucide-react-native';
import { formatHHMM } from '../../timestamp';
import { colors } from '../../theme/tokens';
import { ClosureProfile } from '../../types';
import { Tile, TileLabel } from './Tile';
import { ClosureProgressBar } from './ClosureProgressBar';

type BarState =
  | 'blip-early'
  | 'blip-approaching'
  | 'break-shifted'
  | 'break-origin'
  | 'past-break';

function deriveBarState(profile: ClosureProfile): BarState {
  const { closureType, elapsedMinutes, blipEstimateMinutes, breakEstimateMinutes } = profile;

  if (closureType === 'break') {
    return elapsedMinutes > breakEstimateMinutes ? 'past-break' : 'break-origin';
  }

  // blip classification
  if (elapsedMinutes > blipEstimateMinutes) {
    return elapsedMinutes > breakEstimateMinutes ? 'past-break' : 'break-shifted';
  }
  return elapsedMinutes > blipEstimateMinutes * 0.75 ? 'blip-approaching' : 'blip-early';
}

const BAR_COLOR: Record<BarState, string> = {
  'blip-early':       colors.textTertiary,
  'blip-approaching': colors.brand,
  'break-shifted':    colors.star,
  'break-origin':     colors.star,
  'past-break':       colors.skip,
};

interface Props {
  isDown: boolean;
  isPaid: boolean;
  rideClosedAt: string | null;
  closureProfile: ClosureProfile | null | undefined;
  predictedReopenAt: string | null | undefined;
  onNotifyReopen: () => Promise<void>;
  onUnlock: () => void;
}

export function ClosureTile({
  isDown,
  isPaid,
  rideClosedAt,
  closureProfile,
  predictedReopenAt,
  onNotifyReopen,
  onUnlock,
}: Props): React.ReactElement | null {
  if (!isDown) return null;

  const closedAtLabel = rideClosedAt ? formatHHMM(rideClosedAt) : null;

  return (
    <Tile>
      <TileLabel>Closure</TileLabel>

      {/* "Down since X" — always shown, free and paid */}
      {closedAtLabel ? (
        <Text style={styles.closedAt}>
          Down since <Text style={styles.bold}>{closedAtLabel}</Text>
        </Text>
      ) : (
        <Text style={styles.closedAt}>Currently down.</Text>
      )}

      {/* Free tier — lock CTA */}
      {!isPaid ? (
        <Pressable onPress={onUnlock} style={styles.lockRow}>
          <Lock size={13} color={colors.textTertiary} />
          <Text style={styles.lockText}>Reopen estimate · Unlock</Text>
        </Pressable>
      ) : !closureProfile || closureProfile.confidenceLevel === 'suppressed' ? (
        /* Paid but no profile / suppressed — timer only, no bar */
        null
      ) : (
        /* Paid + high confidence — full bar + state copy */
        <PaidContent
          profile={closureProfile}
          predictedReopenAt={predictedReopenAt ?? null}
          onNotifyReopen={onNotifyReopen}
        />
      )}
    </Tile>
  );
}

// ── Paid content (bar + copy + optional notify CTA) ──────────────────────────

function PaidContent({
  profile,
  predictedReopenAt,
  onNotifyReopen,
}: {
  profile: ClosureProfile;
  predictedReopenAt: string | null;
  onNotifyReopen: () => Promise<void>;
}): React.ReactElement {
  const { elapsedMinutes, blipEstimateMinutes, breakEstimateMinutes, predictedReopenWait } = profile;
  const barState = deriveBarState(profile);
  const fillColor = BAR_COLOR[barState];
  const isBreakState = barState === 'break-shifted' || barState === 'break-origin' || barState === 'past-break';
  const overflow = barState === 'past-break';

  const rightEdge = isBreakState ? breakEstimateMinutes : blipEstimateMinutes;
  const ghostTick = isBreakState ? blipEstimateMinutes : null;

  return (
    <>
      <ClosureProgressBar
        elapsedMinutes={elapsedMinutes}
        rightEdgeMinutes={rightEdge}
        ghostTickMinutes={ghostTick}
        fillColor={fillColor}
        overflow={overflow}
      />

      {/* State 5 — predicted post-reopen wait sub-card (additive on break states) */}
      {isBreakState && predictedReopenWait != null ? (
        <View style={styles.predictedWaitCard}>
          <Text style={styles.predictedWaitLabel}>LIKELY WAIT WHEN IT REOPENS</Text>
          <Text style={styles.predictedWaitNumber}>~{predictedReopenWait}</Text>
          <Text style={styles.predictedWaitContext}>
            Well below its usual ~{breakEstimateMinutes}m wait
          </Text>
        </View>
      ) : null}

      {/* State copy */}
      <StateCopy
        barState={barState}
        elapsed={elapsedMinutes}
        blipEst={blipEstimateMinutes}
        breakEst={breakEstimateMinutes}
        hasPredictedWait={predictedReopenWait != null}
      />

      {/* Notify me CTA — break states only */}
      {isBreakState && predictedReopenAt ? (
        <Pressable
          onPress={() => { void onNotifyReopen(); }}
          style={styles.notifyBtn}
          accessibilityRole="button"
        >
          <Bell size={16} color={colors.textInverse} />
          <Text style={styles.notifyBtnText}>Notify me when it reopens</Text>
        </Pressable>
      ) : null}
    </>
  );
}

// ── State copy ────────────────────────────────────────────────────────────────

function StateCopy({
  barState,
  elapsed,
  blipEst,
  breakEst,
  hasPredictedWait,
}: {
  barState: BarState;
  elapsed: number;
  blipEst: number;
  breakEst: number;
  hasPredictedWait: boolean;
}): React.ReactElement | null {
  switch (barState) {
    case 'blip-early':
    case 'blip-approaching':
      return (
        <View style={styles.copyBlock}>
          <Text style={styles.primaryCopy}>Usually back in ~{blipEst}m</Text>
          <Text style={styles.secondaryCopy}>Could run up to ~{breakEst}m</Text>
        </View>
      );

    case 'break-shifted':
      return (
        <View style={styles.copyBlock}>
          <Text style={[styles.primaryCopy, styles.alertCopy]}>Taking longer than usual</Text>
          {hasPredictedWait ? (
            <Text style={styles.secondaryCopy}>Still closed — now looking more like ~{breakEst}m total</Text>
          ) : (
            <Text style={styles.secondaryCopy}>Now looking more like ~{breakEst}m</Text>
          )}
        </View>
      );

    case 'break-origin':
      return (
        <View style={styles.copyBlock}>
          <Text style={[styles.primaryCopy, styles.alertCopy]}>Likely an extended closure</Text>
          {hasPredictedWait ? (
            <Text style={styles.secondaryCopy}>Still closed — now looking more like ~{breakEst}m total</Text>
          ) : elapsed < blipEst ? (
            // Blip window hasn't passed yet — mention the quicker possibility.
            <Text style={styles.secondaryCopy}>
              Usually back around ~{breakEst}m — could be quicker, ~{blipEst}m
            </Text>
          ) : (
            // Blip window has passed — drop the "could be quicker" clause.
            <Text style={styles.secondaryCopy}>Usually back around ~{breakEst}m</Text>
          )}
        </View>
      );

    case 'past-break':
      return (
        <View style={styles.copyBlock}>
          <Text style={[styles.primaryCopy, styles.alertCopy]}>Longer than we've seen</Text>
          <Text style={styles.secondaryCopy}>
            No estimate, but expect a short line whenever it reopens
          </Text>
        </View>
      );

    default:
      return null;
  }
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  closedAt: {
    fontSize: 13,
    color: colors.textSecondary,
    marginBottom: 2,
  },
  bold: { fontWeight: '700' },

  // Free tier
  lockRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 10,
  },
  lockText: {
    fontSize: 13,
    color: colors.textTertiary,
  },

  // State 5 — predicted wait sub-card
  predictedWaitCard: {
    marginTop: 14,
    padding: 12,
    backgroundColor: colors.goBg,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: colors.goBorder,
    alignItems: 'center',
  },
  predictedWaitLabel: {
    fontSize: 9.5,
    fontWeight: '600',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.brand,
    marginBottom: 4,
  },
  predictedWaitNumber: {
    fontSize: 30,
    fontWeight: '700',
    color: colors.brand,
    fontVariant: ['tabular-nums'],
    lineHeight: 36,
  },
  predictedWaitContext: {
    fontSize: 11,
    color: colors.textSecondary,
    marginTop: 2,
  },

  // State copy
  copyBlock: { marginTop: 10 },
  primaryCopy: {
    fontSize: 13,
    fontWeight: '600',
    color: colors.textPrimary,
    marginBottom: 2,
  },
  alertCopy: { color: colors.skip },
  secondaryCopy: {
    fontSize: 12,
    color: colors.textSecondary,
  },

  // Notify CTA
  notifyBtn: {
    marginTop: 12,
    width: '100%',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 13,
  },
  notifyBtnText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textInverse,
  },
});
