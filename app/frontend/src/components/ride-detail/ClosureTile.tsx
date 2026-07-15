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

// Fallback for same-day closures that have run absurdly long (6+ hours)
// without spanning midnight. In practice the date check fires first.
const SAME_DAY_EXTENDED_MIN = 6 * 60;

type BarState =
  | 'blip-early'
  | 'blip-approaching'
  | 'break-shifted'
  | 'break-origin'
  | 'past-break'
  | 'extended';

// Returns true when the closure crossed midnight (closed on a different
// calendar day than today) or has been running 6+ hours on the same day.
function isOvernightClosure(rideClosedAt: string | null, elapsedMinutes: number): boolean {
  if (rideClosedAt) {
    const closed = new Date(rideClosedAt);
    const now = new Date();
    if (
      closed.getFullYear() !== now.getFullYear() ||
      closed.getMonth() !== now.getMonth() ||
      closed.getDate() !== now.getDate()
    ) {
      return true;
    }
  }
  return elapsedMinutes > SAME_DAY_EXTENDED_MIN;
}

function deriveBarState(profile: ClosureProfile, rideClosedAt: string | null): BarState {
  const { closureType, elapsedMinutes, blipEstimateMinutes, breakEstimateMinutes } = profile;

  if (isOvernightClosure(rideClosedAt, elapsedMinutes)) return 'extended';

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
  'extended':         colors.textTertiary, // never used — extended returns early before the bar renders
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
          rideClosedAt={rideClosedAt}
          predictedReopenAt={predictedReopenAt ?? null}
          onNotifyReopen={onNotifyReopen}
        />
      )}
    </Tile>
  );
}

// ── Paid content (bar + copy + optional notify CTA) ──────────────────────────

function formatElapsedHours(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

function PaidContent({
  profile,
  rideClosedAt,
  predictedReopenAt,
  onNotifyReopen,
}: {
  profile: ClosureProfile;
  rideClosedAt: string | null;
  predictedReopenAt: string | null;
  onNotifyReopen: () => Promise<void>;
}): React.ReactElement {
  const { elapsedMinutes, blipEstimateMinutes, breakEstimateMinutes, predictedReopenWait } = profile;
  const barState = deriveBarState(profile, rideClosedAt);
  const isOvernight = rideClosedAt ? new Date(rideClosedAt).getDate() !== new Date().getDate() : false;

  // Extended closure — skip the bar and predictions entirely.
  if (barState === 'extended') {
    return (
      <View style={styles.copyBlock}>
        <Text style={styles.primaryCopy}>
          {isOvernight ? 'Closed overnight' : `Down for ${formatElapsedHours(elapsedMinutes)}`}
        </Text>
        <Text style={styles.secondaryCopy}>
          {isOvernight
            ? "This ride closed yesterday and hasn't reopened. No estimate — check back when the park opens."
            : 'Closed for an extended period. No estimate available.'}
        </Text>
      </View>
    );
  }

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

      {/* Notify me CTA — break states only, and only when the prediction is still
          valid (not past-break). In past-break the estimate is blown and
          predictedReopenAt is stale, so there's nothing reliable to schedule
          a timer against. A proper server-side "watch for actual reopen" is a
          future feature (requires a dedicated watchReopenRideIds field). */}
      {isBreakState && barState !== 'past-break' && predictedReopenAt ? (
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

    case 'extended':
      // PaidContent returns early for this state — StateCopy is never called.
      return null;

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
