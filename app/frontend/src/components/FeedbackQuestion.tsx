// FeedbackQuestion — one rated question in the beta feedback form: a
// "Question X of Y" progress caption, question text, a 5-step slider (snaps
// to preset positions, selected label shown below the track), and a
// collapsed optional note.

import React from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import Slider from '@react-native-community/slider';
import { Card } from './Card';
import { colors, radius, spacing, typography } from '../theme/tokens';

export interface FeedbackQuestionOption {
  value: number;
  label: string;
}

interface Props {
  index: number;
  total: number;
  question: string;
  options: FeedbackQuestionOption[];
  selected: number | null;
  onSelect: (value: number) => void;
  noteExpanded: boolean;
  onToggleNote: () => void;
  noteValue: string;
  onNoteChange: (text: string) => void;
  notePlaceholder?: string;
}

export function FeedbackQuestion({
  index,
  total,
  question,
  options,
  selected,
  onSelect,
  noteExpanded,
  onToggleNote,
  noteValue,
  onNoteChange,
  notePlaceholder = 'Anything specific that stood out?',
}: Props): React.ReactElement {
  const min = options[0];
  const max = options[options.length - 1];
  const mid = options[Math.floor((options.length - 1) / 2)].value;
  const selectedLabel = options.find(opt => opt.value === selected)?.label;

  return (
    <Card style={styles.container}>
      <Text style={styles.progress}>Question {index} of {total}</Text>
      <Text style={styles.question}>{question}</Text>

      <Text style={[styles.selectedLabel, selected === null && styles.selectedLabelPlaceholder]}>
        {selected === null ? 'Slide to answer' : selectedLabel}
      </Text>
      <View style={styles.sliderRow}>
        <Text style={styles.endpointLabel} numberOfLines={2}>{min.label}</Text>
        <Slider
          style={styles.slider}
          minimumValue={min.value}
          maximumValue={max.value}
          step={1}
          value={selected ?? mid}
          onValueChange={onSelect}
          minimumTrackTintColor={colors.brand}
          maximumTrackTintColor={colors.border}
          thumbTintColor={colors.brand}
        />
        <Text style={styles.endpointLabel} numberOfLines={2}>{max.label}</Text>
      </View>

      {noteExpanded ? (
        <TextInput
          style={styles.noteInput}
          value={noteValue}
          onChangeText={onNoteChange}
          placeholder={notePlaceholder}
          placeholderTextColor={colors.textTertiary}
          multiline
        />
      ) : (
        <Pressable onPress={onToggleNote} hitSlop={8} style={styles.addDetailBtn}>
          <Text style={styles.addDetail}>+ Add detail</Text>
        </Pressable>
      )}
    </Card>
  );
}

const styles = StyleSheet.create({
  container: {
    marginBottom: spacing.lg,
    padding: spacing.lg,
  },
  progress: {
    ...typography.caption,
    color: colors.textTertiary,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
    marginBottom: spacing.xs,
  },
  question: {
    fontFamily: 'Lora_600SemiBold',
    fontSize: 19,
    fontWeight: '600',
    letterSpacing: -0.19,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  sliderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
  },
  slider: {
    flex: 1,
  },
  endpointLabel: {
    ...typography.caption,
    color: colors.textTertiary,
    width: 72,
    textAlign: 'center',
  },
  selectedLabel: {
    ...typography.body,
    fontWeight: '600',
    color: colors.brand,
    textAlign: 'center',
    marginBottom: spacing.sm,
  },
  selectedLabelPlaceholder: {
    color: colors.textTertiary,
    fontWeight: '400',
  },
  addDetailBtn: {
    alignSelf: 'flex-start',
    marginTop: spacing.sm,
    paddingVertical: spacing.xs,
  },
  addDetail: {
    fontFamily: 'Outfit_600SemiBold',
    fontSize: 15,
    color: colors.brand,
  },
  noteInput: {
    marginTop: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.md,
    minHeight: 110,
    textAlignVertical: 'top',
    ...typography.body,
    color: colors.textPrimary,
  },
});
