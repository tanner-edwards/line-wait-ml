// Minimal bottom-anchored toast with a single undo action. Auto-dismisses
// after durationMs; the parent owns whether it's mounted at all (mount to
// show, unmount/change key to reset the timer for a new message).

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, radius, shadows, spacing, typography } from '../theme/tokens';

interface UndoToastProps {
  message: string;
  onUndo: () => void;
  onDismiss: () => void;
  durationMs?: number;
}

export function UndoToast({ message, onUndo, onDismiss, durationMs = 4000 }: UndoToastProps): React.ReactElement {
  useEffect(() => {
    const timer = setTimeout(onDismiss, durationMs);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [durationMs]);

  return (
    <View style={styles.container} pointerEvents="box-none">
      <View style={styles.toast}>
        <Text style={styles.message} numberOfLines={1}>{message}</Text>
        <Pressable onPress={onUndo} hitSlop={8}>
          <Text style={styles.action}>Undo</Text>
        </Pressable>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: spacing.xl,
    alignItems: 'center',
    paddingHorizontal: spacing.base,
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    backgroundColor: colors.textPrimary,
    borderRadius: radius.md,
    paddingVertical: spacing.sm + 2,
    paddingHorizontal: spacing.base,
    gap: spacing.md,
    maxWidth: 480,
    width: '100%',
    ...shadows.sheet,
  },
  message: {
    ...typography.body,
    color: colors.textInverse,
    flexShrink: 1,
  },
  action: {
    ...typography.label,
    color: colors.textInverse,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
});
