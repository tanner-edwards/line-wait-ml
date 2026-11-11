// "Why we suggest this" tile in the ride detail sheet. Shows the AI
// recommendation one-liner when the user arrived from the Recommendations tab.
// It costs a Bedrock call, so we only use one that already exists (from the
// recs flow), never generate a new one here.
//
// Renders nothing without an AI line — the deterministic verdict "why" lives
// in the header's verdict banner (phase-4 redesign), so falling back to it here
// would just repeat the banner.

import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import { Sparkles } from 'lucide-react-native';
import { colors, typography } from '../../theme/tokens';
import { Tile } from './Tile';

interface Props {
  oneLiner: string | null;   // AI recommendation reason (from the Recommendations tab)
}

export function ReasonCard({ oneLiner }: Props): React.ReactElement | null {
  if (!oneLiner) return null;

  return (
    <Tile>
      <View style={styles.row}>
        <Sparkles size={22} color={colors.star} fill={colors.star} />
        <View style={styles.body}>
          <Text style={styles.title}>Why we suggest this</Text>
          <Text style={styles.text}>{oneLiner}</Text>
        </View>
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
  body: { flex: 1 },
  title: {
    ...typography.cardTitle,
    color: colors.textPrimary,
    marginBottom: 2,
  },
  text: {
    fontSize: 13,
    color: colors.textPrimary,
    lineHeight: 19,
  },
});
