// Filter chips above the Discover list. One row: the active chip first, then
// the rest in default order — as many as fit — then "More ⌄". More expands
// the hidden chips onto wrapped lines below; picking one collapses the bar
// and moves that chip to the front.
//
// [● Nearby] [By Land] [Your List] [More ⌄]
// [Opportunity] [Shortest Wait] [Most Popular]     ← expanded only
// [A–Z by Land]
//
// Home.tsx owns which chip is active; this owns expand/collapse and fitting.

import React, { useState } from 'react';
import { LayoutChangeEvent, Pressable, StyleSheet, Text, View } from 'react-native';
import {
  ArrowDownAZ,
  Bell,
  Castle,
  ChevronDown,
  ChevronUp,
  MapPin,
  Sparkles,
  Timer,
  Users,
} from 'lucide-react-native';
import { colors, fonts, spacing } from '../theme/tokens';

export type DiscoverChip = 'nearby' | 'land' | 'list' | 'opportunity' | 'wait' | 'demand' | 'az';

const CHIPS: { key: DiscoverChip; label: string; icon: typeof MapPin }[] = [
  { key: 'nearby', label: 'Nearby', icon: MapPin },
  { key: 'land', label: 'By Land', icon: Castle },
  // Bell, not heart/bookmark — matches Watch everywhere else.
  { key: 'list', label: 'Your List', icon: Bell },
  { key: 'opportunity', label: 'Opportunity', icon: Sparkles },
  { key: 'wait', label: 'Shortest Wait', icon: Timer },
  { key: 'demand', label: 'Most Popular', icon: Users },
  { key: 'az', label: 'A–Z by Land', icon: ArrowDownAZ },
];

const GAP = spacing.sm;

interface Props {
  active: DiscoverChip;
  /** Shown in place of "By Land" once a land is picked. */
  landLabel: string | null;
  /** By Land opens the land picker; Home sets it active once a land is picked. */
  onSelect: (chip: DiscoverChip) => void;
}

export function DiscoverChips({ active, landLabel, onSelect }: Props): React.ReactElement {
  const [expanded, setExpanded] = useState(false);
  const [rowW, setRowW] = useState(0);
  const [widths, setWidths] = useState<Partial<Record<DiscoverChip | 'more', number>>>({});

  const labelFor = (key: DiscoverChip, label: string) =>
    key === 'land' && active === 'land' && landLabel ? landLabel : label;
  const ordered = [...CHIPS.filter(c => c.key === active), ...CHIPS.filter(c => c.key !== active)];

  // Until every chip is measured (first frame, and in tests) show them all;
  // the row clips the overflow.
  const measured = rowW > 0 && widths.more !== undefined && ordered.every(c => widths[c.key] !== undefined);
  let visibleCount = ordered.length;
  if (measured) {
    const total = ordered.reduce((sum, c) => sum + widths[c.key]!, 0) + GAP * (ordered.length - 1);
    if (total > rowW) {
      // Reserve room for More; the active chip always shows.
      let used = widths.more!;
      visibleCount = 0;
      for (const c of ordered) {
        const next = used + GAP + widths[c.key]!;
        if (visibleCount > 0 && next > rowW) break;
        used = next;
        visibleCount++;
      }
    }
  }
  const visible = ordered.slice(0, visibleCount);
  const hidden = ordered.slice(visibleCount);

  const select = (key: DiscoverChip) => {
    setExpanded(false);
    onSelect(key);
  };
  const measure = (key: DiscoverChip | 'more') => (e: LayoutChangeEvent) => {
    const w = e.nativeEvent.layout.width;
    setWidths(prev => (prev[key] === w ? prev : { ...prev, [key]: w }));
  };
  const renderChip = (c: (typeof CHIPS)[number]) => (
    <Chip
      key={c.key}
      icon={c.icon}
      label={labelFor(c.key, c.label)}
      active={c.key === active}
      onPress={() => select(c.key)}
      testID={`chip-${c.key}`}
    />
  );

  return (
    <View style={styles.container}>
      <View
        style={styles.row}
        onLayout={e => setRowW(e.nativeEvent.layout.width)}
        testID="chips-row"
      >
        {visible.map(renderChip)}
        {hidden.length > 0 ? (
          <Chip
            label="More"
            trailingIcon={expanded ? ChevronUp : ChevronDown}
            active={false}
            onPress={() => setExpanded(e => !e)}
            testID="chip-more"
          />
        ) : null}
      </View>
      {expanded && hidden.length > 0 ? (
        <View style={styles.expanded} testID="chips-expanded">
          {hidden.map(renderChip)}
        </View>
      ) : null}

      {/* Off-screen copies at natural width — sizes for the fit calculation. */}
      <View
        style={styles.measureRow}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        {CHIPS.map(c => (
          <View key={c.key} onLayout={measure(c.key)} testID={`chip-measure-${c.key}`}>
            <Chip icon={c.icon} label={labelFor(c.key, c.label)} active={false} onPress={noop} />
          </View>
        ))}
        <View onLayout={measure('more')} testID="chip-measure-more">
          <Chip label="More" trailingIcon={ChevronDown} active={false} onPress={noop} />
        </View>
      </View>
    </View>
  );
}

const noop = () => {};

function Chip({
  icon: Icon,
  trailingIcon: Trailing,
  label,
  active,
  onPress,
  testID,
}: {
  icon?: typeof MapPin;
  trailingIcon?: typeof MapPin;
  label: string;
  active: boolean;
  onPress: () => void;
  testID?: string;
}) {
  const fg = active ? colors.textInverse : colors.textPrimary;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => [styles.chip, active && styles.chipActive, pressed && styles.chipPressed]}
      testID={testID}
    >
      {Icon ? <Icon size={16} color={fg} /> : null}
      <Text style={[styles.label, { color: fg }]} numberOfLines={1}>{label}</Text>
      {Trailing ? <Trailing size={16} color={fg} /> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  container: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.base,
    paddingBottom: spacing.sm,
  },
  row: {
    flexDirection: 'row',
    gap: GAP,
    overflow: 'hidden',
  },
  expanded: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: GAP,
    marginTop: GAP,
  },
  measureRow: {
    position: 'absolute',
    top: 0,
    left: 0,
    flexDirection: 'row',
    opacity: 0,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: 999,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    backgroundColor: colors.surface,
  },
  chipActive: {
    backgroundColor: colors.brand,
    borderColor: colors.brand,
  },
  chipPressed: { opacity: 0.8 },
  label: { fontFamily: fonts.uiSemiBold, fontSize: 14, fontWeight: '600' },
});
