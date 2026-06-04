// Bottom-sheet that asks "Which parks today?" — shown by RootNavigator
// whenever persona is set but daily context is stale (new calendar day).
// Mandatory: there's no Cancel; the user must pick one before the app
// renders normally.

import React from 'react';
import {
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { DailyParks } from '../types';
import { useDailyContext } from '../context/DailyContextContext';

const OPTIONS: { value: DailyParks; title: string; subtitle?: string }[] = [
  { value: 'disneyland',           title: 'Disneyland',          subtitle: 'Castle, dark rides, the originals' },
  { value: 'california-adventure', title: 'Disney California Adventure', subtitle: 'Cars Land, Pixar Pier, Avengers Campus' },
  { value: 'both',                 title: 'Both (Park Hopper)',  subtitle: 'Bouncing between parks today' },
];

interface Props {
  visible: boolean;
  onSelect?: () => void;
  onCancel?: () => void;
}

export function DailyParkSheet({ visible, onSelect, onCancel }: Props): React.ReactElement {
  const { setDailyParks } = useDailyContext();

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        {onCancel ? (
          <Pressable style={styles.dismissArea} onPress={onCancel} />
        ) : (
          <View style={styles.dismissArea} />
        )}
        <View style={styles.card}>
          <View style={styles.grabber} />
          <View style={styles.titleRow}>
            <Text style={styles.title}>Which parks today?</Text>
            {onCancel ? (
              <Pressable onPress={onCancel} hitSlop={12} testID="daily-park-cancel">
                <Text style={styles.cancelX}>✕</Text>
              </Pressable>
            ) : null}
          </View>
          <Text style={styles.subtitle}>
            We'll filter rides and recommendations to where you're spending the day.
          </Text>
          {OPTIONS.map(opt => (
            <Pressable
              key={opt.value}
              onPress={() => { void setDailyParks(opt.value); onSelect?.(); }}
              style={({ pressed }) => [styles.row, pressed && styles.rowPressed]}
              testID={`daily-park-${opt.value}`}
            >
              <View style={styles.rowText}>
                <Text style={styles.rowTitle}>{opt.title}</Text>
                {opt.subtitle ? <Text style={styles.rowSubtitle}>{opt.subtitle}</Text> : null}
              </View>
              <Text style={styles.rowChevron}>›</Text>
            </Pressable>
          ))}
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.45)',
    justifyContent: 'flex-end',
  },
  dismissArea: { flex: 1 },
  card: {
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 36,
  },
  grabber: {
    alignSelf: 'center',
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#ddd',
    marginBottom: 16,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 6,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: '#111',
  },
  cancelX: { fontSize: 20, color: '#999' },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 20,
    lineHeight: 20,
  },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 16,
    paddingHorizontal: 12,
    marginBottom: 10,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: '#e0e0e0',
    backgroundColor: '#fff',
    minHeight: 64,
  },
  rowPressed: {
    backgroundColor: '#f4f4ff',
    borderColor: '#6b6bf5',
  },
  rowText: { flex: 1 },
  rowTitle: { fontSize: 16, fontWeight: '600', color: '#222' },
  rowSubtitle: { fontSize: 13, color: '#777', marginTop: 4 },
  rowChevron: { fontSize: 22, color: '#bbb' },
});
