// Reason tile in the ride detail sheet. Shows the AI recommendation one-liner
// when the user arrived from the Recommendations tab (with a Sparkles icon so
// the AI insight pops); otherwise falls back to the deterministic verdict "why"
// with NO icon. The AI line trumps because it's richer/persona-aware — but it
// costs a Bedrock call, so we only use one that already exists (from the recs
// flow), never generate a new one here. Renders nothing when there's neither.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { colors } from '../../theme/tokens';
import { Badge } from '../../types';
import { Tile } from './Tile';

interface Props {
  oneLiner: string | null;   // AI recommendation reason (from the Recommendations tab)
  whyText: string | null;    // deterministic verdict "why" — fallback when no AI one-liner
  badge: Badge;              // verdict badge — tints the deterministic case to match the chip
}

// Badge-matched tint + dot so the deterministic "why" reads as belonging to the
// verdict chip above it. Neutral (no badge, e.g. high-but-steady) → gray.
const ACCENT: Record<'go' | 'star' | 'skip', { bg: string; dot: string }> = {
  go:   { bg: colors.goBg,   dot: colors.go },
  star: { bg: colors.starBg, dot: colors.star },
  skip: { bg: colors.skipBg, dot: colors.skip },
};
const NEUTRAL_ACCENT = { bg: colors.cautionBg, dot: colors.textTertiary };

export function ReasonCard({ oneLiner, whyText, badge }: Props): React.ReactElement | null {
  const isAI = !!oneLiner;
  const text = oneLiner ?? whyText;
  if (!text) return null;

  // AI keeps its own look (white card + Sparkles). The deterministic "why"
  // borrows the badge color so it visually chains to the chip.
  const accent = badge && badge !== 'caution' ? ACCENT[badge] : NEUTRAL_ACCENT;

  return (
    <Tile style={isAI ? undefined : { backgroundColor: accent.bg }}>
      <View style={styles.row}>
        {isAI ? (
          <View style={styles.iconContainer}>
            <Sparkles size={16} color={colors.brand} />
          </View>
        ) : (
          <View style={[styles.dot, { backgroundColor: accent.dot }]} />
        )}
        <Text style={styles.text}>{text}</Text>
      </View>
    </Tile>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
  },
  iconContainer: {
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: 'rgba(10,107,90,0.08)',
    alignItems: 'center',
    justifyContent: 'center',
    flexShrink: 0,
  },
  // Small badge-colored dot for the deterministic "why" (in place of Sparkles).
  dot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginTop: 5,
    flexShrink: 0,
  },
  text: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 19,
  },
});
