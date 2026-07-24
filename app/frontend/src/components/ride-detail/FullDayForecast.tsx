// Full-day bar chart for the ride detail sheet.
//
// Each bar represents one hour. Its height and color are driven by the
// lowest predicted wait within that hour (across all 30-min sub-slots),
// so the bar always shows the best opportunity inside the hour.
//
// Tapping reveals the specific 30-min window that is cheapest, so the
// "Remind me" time and the detail label are precise, not rounded to the
// top of the hour.
//
// Color is relative to the ride's own predicted range for the day (P10/P90)
// so that green and red always mean something even on always-busy rides.

import React, { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Animated, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { Check } from 'lucide-react-native';
import { colors } from '../../theme/tokens';
import { FullDaySlot, Prediction, RecentSnapshot } from '../../types';
import { scheduleRideReminder } from '../../utils/scheduleReminder';
import { roundWait } from '../../utils/roundWait';

// ── Design tokens ─────────────────────────────────────────────────────────────
//
// Bar palette comes from tokens.ts so the forecast bars stay in sync with the
// rest of the app's status colors. Detail card + badge tints derive from the
// same trough/peak/brand bases at lower opacity.

const BAR_TROUGH        = colors.barTrough;
const BAR_PEAK          = colors.barPeak;
const BAR_NEUTRAL       = colors.barNeutral;
const BAR_TROUGH_PAST   = colors.barTroughPast;
const BAR_PEAK_PAST     = colors.barPeakPast;
const BAR_NEUTRAL_PAST  = colors.barNeutralPast;

const DETAIL_TROUGH_BG      = 'rgba(61,124,101,0.06)';
const DETAIL_TROUGH_BORDER  = 'rgba(61,124,101,0.22)';
const DETAIL_PEAK_BG        = 'rgba(184,58,42,0.05)';
const DETAIL_PEAK_BORDER    = 'rgba(184,58,42,0.18)';
const DETAIL_NEUTRAL_BG     = 'rgba(10,107,90,0.05)';
const DETAIL_NEUTRAL_BORDER = 'rgba(10,107,90,0.14)';

const BADGE_TROUGH_BG  = 'rgba(61,124,101,0.10)';
const BADGE_PEAK_BG    = 'rgba(184,58,42,0.08)';
const BADGE_NEUTRAL_BG = 'rgba(10,107,90,0.08)';

// Chart layout.
const CHART_H   = 72;
const MIN_BAR_H = 4;
const DOT_SIZE  = 6;

// ── Types ─────────────────────────────────────────────────────────────────────

type Classification = 'trough' | 'peak' | 'neutral';

// One bar in the chart. Driven by the best (cheapest) 30-min sub-slot
// within the hour, not the :00 slot.
interface DisplaySlot {
  hourStart: number;       // hour boundary in minutes-from-midnight (e.g. 780 = 1pm)
  bestSlotStart: number;   // startMinutes of the cheapest 30-min sub-slot
  bestTimeSlot: string;    // e.g. "13:30-14:00" — for accessibility / debug
  wait: number;            // min wait within the hour (drives height + color)
  classification: Classification;
  isPast: boolean;
  isCurrent: boolean;
}

// ── Pure helpers ──────────────────────────────────────────────────────────────

function getLAMinutesFromMidnight(): number {
  const now = new Date();
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  });
  const parts = fmt.formatToParts(now);
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0);
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0);
  return h * 60 + m;
}

function percentileOf(sorted: number[], pct: number): number {
  if (sorted.length === 0) return 0;
  if (sorted.length === 1) return sorted[0];
  const idx = (pct / 100) * (sorted.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

// Group 30-min slots into 1-hour buckets. Each bucket retains only the
// cheapest sub-slot so the bar represents the best opportunity in that hour.
function buildDisplaySlots(
  fullDayForecast: FullDaySlot[],
  currentHourStart: number
): DisplaySlot[] {
  // Collect non-null slots into hour buckets.
  const byHour = new Map<number, Array<FullDaySlot & { wait: number }>>();
  for (const slot of fullDayForecast) {
    if (slot.wait === null) continue;
    const hourStart = Math.floor(slot.startMinutes / 60) * 60;
    const bucket = byHour.get(hourStart) ?? [];
    bucket.push(slot as FullDaySlot & { wait: number });
    byHour.set(hourStart, bucket);
  }
  if (byHour.size === 0) return [];

  // Build one entry per hour — best (lowest-wait) sub-slot wins.
  const hours = [...byHour.entries()].sort(([a], [b]) => a - b);
  const bestPerHour = hours.map(([hourStart, subSlots]) => {
    const best = subSlots.reduce((min, s) => s.wait < min.wait ? s : min, subSlots[0]);
    return { hourStart, best };
  });

  // Classify by P10/P90 of the per-hour minimums so color is always relative.
  const sortedWaits = [...bestPerHour.map(h => h.best.wait)].sort((a, b) => a - b);
  const p10 = percentileOf(sortedWaits, 10);
  const p90 = percentileOf(sortedWaits, 90);

  return bestPerHour.map(({ hourStart, best }) => ({
    hourStart,
    bestSlotStart: best.startMinutes,
    bestTimeSlot: best.timeSlot,
    wait: best.wait,
    classification: best.wait <= p10 ? 'trough' : best.wait >= p90 ? 'peak' : 'neutral',
    isPast: hourStart < currentHourStart,
    isCurrent: hourStart === currentHourStart,
  }));
}

function findDefaultSelection(slots: DisplaySlot[], currentHourStart: number): number | null {
  return slots.find(s => s.hourStart > currentHourStart && s.classification === 'trough')?.hourStart ?? null;
}

function barColor(cls: Classification, isPast: boolean): string {
  if (isPast) {
    return cls === 'trough' ? BAR_TROUGH_PAST : cls === 'peak' ? BAR_PEAK_PAST : BAR_NEUTRAL_PAST;
  }
  return cls === 'trough' ? BAR_TROUGH : cls === 'peak' ? BAR_PEAK : BAR_NEUTRAL;
}

function formatHourLabel(hourStart: number): string {
  const h = Math.floor(hourStart / 60);
  const h12 = h % 12 || 12;
  return `${h12}${h >= 12 ? 'p' : 'a'}`;
}

// Shows the specific 30-min window, e.g. "1:30 – 2:00 PM".
function formatBestWindowLabel(bestSlotStart: number): string {
  const endMins = bestSlotStart + 30;
  const fmtHM = (mins: number) => {
    const h = Math.floor(mins / 60) % 24;
    const m = mins % 60;
    const h12 = h % 12 || 12;
    const mm = m === 0 ? ':00' : `:${m.toString().padStart(2, '0')}`;
    return `${h12}${mm}`;
  };
  const endH = Math.floor(endMins / 60) % 24;
  const period = endH >= 12 ? 'PM' : 'AM';
  return `${fmtHM(bestSlotStart)} – ${fmtHM(endMins)} ${period}`;
}

// Reminder fires 15 min before the best 30-min slot starts.
function formatReminderTime(bestSlotStart: number): string {
  const mins = Math.max(0, bestSlotStart - 15);
  const h = Math.floor(mins / 60) % 24;
  const m = mins % 60;
  const h12 = h % 12 || 12;
  const mm = m === 0 ? ':00' : `:${m.toString().padStart(2, '0')}`;
  return `${h12}${mm} ${h >= 12 ? 'PM' : 'AM'}`;
}

// Overwrite the T+60, T+90, T+120, T+150 sub-slots with the 2-hour model's
// values so the near-term hour bars reflect the more accurate short-horizon
// model. All four sub-slots within the two affected hour buckets are patched
// so buildDisplaySlots' minimum-within-bucket logic picks up the override.
function applyNearTermSubstitution(
  forecast: FullDaySlot[],
  prediction: Prediction | null,
  currentHourStart: number
): FullDaySlot[] {
  if (!prediction) return forecast;
  const targets = new Map<number, number>([
    [currentHourStart + 60,  prediction.t60],
    [currentHourStart + 90,  prediction.t90],
    [currentHourStart + 120, prediction.t120],
    [currentHourStart + 150, prediction.t150],
  ]);
  return forecast.map(slot =>
    slot.wait !== null && targets.has(slot.startMinutes)
      ? { ...slot, wait: targets.get(slot.startMinutes)! }
      : slot
  );
}

// Average the actual wait observations from recentHistory that fall within
// the previous hour bucket. Filters out DOWN snapshots and null waits.
// Returns null when there's no usable data (falls back to day model).
function computePrevHourActual(
  recentHistory: RecentSnapshot[] | null,
  currentMins: number,
  currentHourStart: number
): number | null {
  if (!recentHistory?.length) return null;
  const prevHourStart = currentHourStart - 60;
  const waits = recentHistory
    .filter(s => {
      const snapshotHour = Math.floor((currentMins - s.minutesAgo) / 60) * 60;
      return snapshotHour === prevHourStart && s.wait != null && s.status !== 'DOWN';
    })
    .map(s => s.wait as number);
  if (waits.length === 0) return null;
  return Math.round(waits.reduce((sum, w) => sum + w, 0) / waits.length);
}

// ── Main component ────────────────────────────────────────────────────────────

interface Props {
  fullDayForecast: FullDaySlot[];
  rideName: string;
  prediction?: Prediction | null;
  currentWait?: number | null;
  recentHistory?: RecentSnapshot[] | null;
}

export function FullDayForecast({ fullDayForecast, rideName, prediction = null, currentWait = null, recentHistory = null }: Props): React.ReactElement | null {
  const currentMins     = useMemo(() => getLAMinutesFromMidnight(), []);
  const currentHourStart = Math.floor(currentMins / 60) * 60;

  // Session-sticky substitutions: once a slot is rendered with the 2-hour
  // model's value, that value is held for the session. Prevents a hue/height
  // flip when the slot ages into the past and the day model would otherwise
  // take over.
  const stickySlots = useRef<Map<number, { wait: number; classification: Classification }>>(new Map());

  const displaySlots = useMemo(() => {
    let patchedForecast = applyNearTermSubstitution(fullDayForecast, prediction, currentHourStart);

    // Ground the current-hour bar in the live wait when available.
    // Falls back to the day model's value when currentWait is null so the
    // bar stays visible and consistent across the hour boundary.
    if (currentWait != null) {
      patchedForecast = patchedForecast.map(slot =>
        slot.startMinutes === currentHourStart || slot.startMinutes === currentHourStart + 30
          ? { ...slot, wait: currentWait }
          : slot
      );
    }

    // Replace the previous hour's day-model values with the average of actual
    // wait observations from recentHistory for that window.
    const prevHourActual = computePrevHourActual(recentHistory, currentMins, currentHourStart);
    if (prevHourActual != null) {
      patchedForecast = patchedForecast.map(slot =>
        slot.startMinutes === currentHourStart - 60 || slot.startMinutes === currentHourStart - 30
          ? { ...slot, wait: prevHourActual }
          : slot
      );
    }

    const slots = buildDisplaySlots(patchedForecast, currentHourStart);

    // Write the T+60 and T+120 hour bars into the sticky cache while they're
    // still future, so the cache is populated before the slot ages to past.
    const substitutedHours = new Set([currentHourStart + 60, currentHourStart + 120]);
    for (const slot of slots) {
      if (!slot.isPast && !slot.isCurrent && substitutedHours.has(slot.hourStart)) {
        stickySlots.current.set(slot.hourStart, { wait: slot.wait, classification: slot.classification });
      }
    }

    // When a previously-substituted slot ages into the past, use the cached
    // value instead of letting the day model reclaim it.
    return slots.map(slot => {
      if (slot.isPast) {
        const cached = stickySlots.current.get(slot.hourStart);
        if (cached) return { ...slot, wait: cached.wait, classification: cached.classification };
      }
      return slot;
    });
  }, [fullDayForecast, prediction, currentWait, recentHistory, currentHourStart]);

  const [selectedHour, setSelectedHour] = useState<number | null>(() =>
    findDefaultSelection(displaySlots, currentHourStart)
  );

  const selectedSlot = displaySlots.find(s => s.hourStart === selectedHour) ?? null;

  const fadeAnim = useRef(new Animated.Value(selectedSlot ? 1 : 0)).current;
  useEffect(() => {
    Animated.timing(fadeAnim, {
      toValue: selectedSlot ? 1 : 0,
      duration: 180,
      useNativeDriver: true,
    }).start();
  }, [selectedSlot, fadeAnim]);

  if (displaySlots.length === 0) return null;

  const dayMax = displaySlots.reduce((mx, s) => Math.max(mx, s.wait), 0);

  const handleBarPress = (slot: DisplaySlot) => {
    setSelectedHour(prev => (prev === slot.hourStart ? null : slot.hourStart));
  };

  return (
    <View>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>FULL DAY FORECAST</Text>
        <Text style={styles.headerSubtitle}>Tap a bar to see details</Text>
      </View>

      {/* Bar chart */}
      <View style={styles.barsRow}>
        {displaySlots.map(slot => {
          const barH     = Math.max(MIN_BAR_H, Math.round((slot.wait / dayMax) * CHART_H));
          const color    = barColor(slot.classification, slot.isPast || slot.isCurrent);
          const isSelected = slot.hourStart === selectedHour;

          const selectionColor = slot.classification === 'trough' ? BAR_TROUGH
            : slot.classification === 'peak' ? BAR_PEAK
            : colors.brand;

          return (
            <Pressable
              key={slot.hourStart}
              style={styles.barColumn}
              onPress={() => handleBarPress(slot)}
              disabled={slot.isPast || slot.isCurrent}
              accessibilityRole="button"
              accessibilityLabel={`${formatBestWindowLabel(slot.bestSlotStart)}: ~${roundWait(slot.wait)} min predicted`}
            >
              <View style={styles.barArea}>
                {/* Now dot — floats just above the bar top regardless of height */}
                {slot.isCurrent ? (
                  <View style={{ position: 'absolute', bottom: barH + 3, left: 0, right: 0, alignItems: 'center' }}>
                    <View style={styles.nowDot} />
                  </View>
                ) : null}
                <View
                  style={[
                    styles.bar,
                    { height: barH, backgroundColor: color },
                    isSelected && ({
                      boxShadow: `0 0 0 1.5px white, 0 0 0 3px ${selectionColor}`,
                    } as any),
                  ]}
                />
              </View>
            </Pressable>
          );
        })}
      </View>

      {/* Time labels */}
      <View style={styles.labelsRow}>
        {displaySlots.map(slot => (
          <View key={slot.hourStart} style={styles.labelCell}>
            <Text style={[styles.timeLabel, slot.isCurrent && styles.nowLabel]} numberOfLines={1}>
              {slot.isCurrent ? 'now' : formatHourLabel(slot.hourStart)}
            </Text>
          </View>
        ))}
      </View>

      {/* Detail card */}
      {selectedSlot ? (
        <>
          <View style={styles.detailDivider} />
          <Animated.View style={{ opacity: fadeAnim }}>
            <SelectedBarDetail slot={selectedSlot} rideName={rideName} />
          </Animated.View>
        </>
      ) : null}
    </View>
  );
}

// ── Selected bar detail card ──────────────────────────────────────────────────

function SelectedBarDetail({ slot, rideName }: { slot: DisplaySlot; rideName: string }): React.ReactElement {
  const cls = slot.classification;

  const cardBg      = cls === 'trough' ? DETAIL_TROUGH_BG     : cls === 'peak' ? DETAIL_PEAK_BG     : DETAIL_NEUTRAL_BG;
  const cardBorder  = cls === 'trough' ? DETAIL_TROUGH_BORDER  : cls === 'peak' ? DETAIL_PEAK_BORDER  : DETAIL_NEUTRAL_BORDER;
  const badgeBg     = cls === 'trough' ? BADGE_TROUGH_BG       : cls === 'peak' ? BADGE_PEAK_BG       : BADGE_NEUTRAL_BG;
  const accentColor = cls === 'trough' ? BAR_TROUGH            : cls === 'peak' ? BAR_PEAK            : colors.brand;

  const badgeLabel  = cls === 'trough' ? 'Best window' : cls === 'peak' ? 'Peak — avoid' : 'Average window';
  const contextLine = cls === 'trough' ? 'Lowest window of the day'
    : cls === 'peak' ? 'Busiest window of the day'
    : 'Around the typical wait for this time';

  const windowLabel  = formatBestWindowLabel(slot.bestSlotStart);
  const reminderTime = formatReminderTime(slot.bestSlotStart);
  // Hide on past bars and on web (web can't schedule local notifications).
  const showReminder = !slot.isPast && Platform.OS !== 'web';

  const [isScheduling, setIsScheduling] = useState(false);
  const [reminderScheduled, setReminderScheduled] = useState(false);

  const handleRemindMe = async () => {
    if (isScheduling || reminderScheduled) return;
    setIsScheduling(true);
    try {
      const result = await scheduleRideReminder(rideName, slot.bestSlotStart - 15);
      switch (result) {
        case 'scheduled':
          setReminderScheduled(true);
          Alert.alert('Reminder set', `We'll notify you at ${reminderTime}.`, [{ text: 'OK' }]);
          break;
        case 'denied':
          Alert.alert(
            'Notifications off',
            'To use reminders, enable notifications for Club 32 in your device Settings.',
            [{ text: 'OK' }]
          );
          break;
        case 'past':
          setReminderScheduled(true);
          break;
      }
    } finally {
      setIsScheduling(false);
    }
  };

  return (
    <View style={[styles.detailCard, { backgroundColor: cardBg, borderColor: cardBorder }]}>
      <View style={styles.detailTopRow}>
        <Text style={styles.windowLabel}>{windowLabel}</Text>
        <View style={[styles.badge, { backgroundColor: badgeBg }]}>
          <Text style={[styles.badgeText, { color: accentColor }]}>{badgeLabel}</Text>
        </View>
      </View>

      <Text style={[styles.predictedWait, { color: accentColor }]}>~{roundWait(slot.wait)}m</Text>
      <Text style={[styles.contextLine, !showReminder && styles.contextLineNoMargin]}>
        {contextLine}
      </Text>

      {showReminder ? (
        <Pressable
          style={[
            styles.remindButton,
            reminderScheduled && styles.remindButtonSet,
            isScheduling && { opacity: 0.6 },
          ]}
          onPress={handleRemindMe}
          accessibilityRole="button"
          disabled={isScheduling || reminderScheduled}
        >
          {reminderScheduled ? (
            <>
              <Check size={14} color={colors.brand} />
              <Text style={[styles.remindButtonText, styles.remindButtonSetText]}>
                Reminder set
              </Text>
            </>
          ) : (
            <Text style={styles.remindButtonText}>Remind me at {reminderTime}</Text>
          )}
        </Pressable>
      ) : null}
    </View>
  );
}

// ── Styles ────────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  header: { marginBottom: 10 },
  headerTitle: {
    fontSize: 10,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 1,
    fontWeight: '600',
  },
  headerSubtitle: {
    fontSize: 11,
    color: colors.textTertiary,
    marginTop: 2,
  },

  barsRow: {
    flexDirection: 'row',
    height: CHART_H,
    columnGap: .5,
  },
  barColumn: {
    flex: 1,
    height: CHART_H,
    alignItems: 'center',
  },
  nowDot: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: DOT_SIZE / 2,
    backgroundColor: colors.brand,
  },
  barArea: {
    flex: 1,
    width: '100%',
    justifyContent: 'flex-end',
    alignItems: 'center',
    paddingHorizontal: 3,
  },
  bar: {
    width: '100%',
    borderRadius: 2,
  },
  labelsRow: {
    flexDirection: 'row',
    marginTop: 4,
    columnGap: .5,
  },
  labelCell: {
    flex: 1,
    alignItems: 'center',
  },
  timeLabel: {
    fontSize: 9,
    color: colors.textTertiary,
  },
  nowLabel: {
    color: colors.brand,
    fontWeight: '700',
  },

  detailDivider: {
    height: 1,
    backgroundColor: colors.border,
    marginTop: 12,
    marginBottom: 10,
  },

  detailCard: {
    borderRadius: 14,
    borderWidth: 1.5,
    padding: 14,
  },
  detailTopRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 6,
  },
  windowLabel: {
    fontSize: 11,
    color: colors.textTertiary,
  },
  badge: {
    borderRadius: 100,
    paddingHorizontal: 10,
    paddingVertical: 3,
  },
  badgeText: {
    fontSize: 11,
    fontWeight: '600',
  },
  predictedWait: {
    fontSize: 26,
    fontWeight: '700',
    letterSpacing: -0.5,
    marginBottom: 4,
  },
  contextLine: {
    fontSize: 12,
    color: colors.textSecondary,
    marginBottom: 14,
  },
  contextLineNoMargin: {
    marginBottom: 0,
  },
  remindButton: {
    backgroundColor: colors.brand,
    borderRadius: 12,
    paddingVertical: 13,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 6,
  },
  remindButtonSet: {
    backgroundColor: colors.goBg,
    borderWidth: 1,
    borderColor: colors.goBorder,
  },
  remindButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: colors.textInverse,
  },
  remindButtonSetText: {
    color: colors.brand,
  },
});
