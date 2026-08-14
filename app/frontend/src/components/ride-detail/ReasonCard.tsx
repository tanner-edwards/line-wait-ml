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

// Badge-matched colored left border + a soft background tint. The bg is a SOLID
// hex = the badge color composited onto WHITE at ~10% — not a transparent tint,
// so the cream canvas behind the card can't show through and darken it.
const ACCENT: Record<'go' | 'star' | 'skip', { bar: string; bg: string }> = {
  go:   { bar: colors.go,   bg: '#ECF2F0' },   // go (61,124,101) on white @10%
  // Star runs richer (~22%) than go/skip: gold shares the cream canvas's warmth,
  // so a 10% tint blends in — it needs a clearer gold to separate from the sheet.
  star: { bar: colors.star, bg: '#F3E8CD' },   // star (201,148,29) on white @~22%
  skip: { bar: colors.skip, bg: '#F8EBEA' },   // skip (184,58,42) on white @10%
};
const NEUTRAL_ACCENT = { bar: colors.textTertiary, bg: '#F3F5F5' }; // neutral on white @10%

export function ReasonCard({ oneLiner, whyText, badge }: Props): React.ReactElement | null {
  const isAI = !!oneLiner;
  const text = oneLiner ?? whyText;
  if (!text) return null;

  // AI keeps its own look (white card + Sparkles). The deterministic "why"
  // borrows the badge color so it visually chains to the chip.
  const accent = badge && badge !== 'caution' ? ACCENT[badge] : NEUTRAL_ACCENT;

  return (
    <Tile style={isAI ? undefined : { borderLeftColor: accent.bar, borderLeftWidth: 3, backgroundColor: accent.bg }}>
      <View style={styles.row}>
        {isAI ? (
          <View style={styles.iconContainer}>
            <Sparkles size={16} color={colors.brand} />
          </View>
        ) : null}
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
  text: {
    flex: 1,
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 19,
  },
});
