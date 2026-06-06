// Shared bottom-sheet primitive. PanResponder is wired to the grabber row only
// so FlatList / ScrollView children scroll without gesture conflict on web.
// Size presets map to fixed heights — no drag-between-snap-points.
//
// TODO (native): when moving to a native build, swap this implementation for
// @gorhom/bottom-sheet v5. The API here is intentionally stable — call sites
// won't need to change (just update internals + wire GestureHandlerRootView
// and BottomSheetModalProvider at the app root).

import React, { useEffect, useRef } from 'react';
import {
  Animated,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { colors, radius, shadows, spacing } from '../theme/tokens';

export interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** When false, backdrop tap and drag-down are both disabled. Default: true. */
  dismissable?: boolean;
  /**
   * Fixed-height preset. Omit to size the sheet to its content (max 90%).
   * half ≈ 50%  |  tall ≈ 85%
   * No snap-between-sizes — each preset is a single fixed height.
   */
  size?: 'half' | 'tall';
  title?: string;
  /** Replaces the default close ✕ button when provided. */
  headerRight?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}

export function Sheet({
  isOpen,
  onClose,
  dismissable = true,
  size,
  title,
  headerRight,
  children,
  testID,
}: SheetProps): React.ReactElement {
  const translateY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (isOpen) translateY.setValue(0);
  }, [isOpen, translateY]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gs) =>
        gs.dy > 5 && gs.dy > Math.abs(gs.dx),
      onPanResponderMove: (_, gs) => {
        if (gs.dy > 0) translateY.setValue(gs.dy);
      },
      onPanResponderRelease: (_, gs) => {
        if (dismissable && (gs.dy > 80 || gs.vy > 0.8)) {
          translateY.setValue(0);
          onClose();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const showHeader = !!title || !!headerRight;
  const closeButton = dismissable ? (
    <Pressable
      onPress={onClose}
      hitSlop={12}
      testID={testID ? `${testID}-close` : undefined}
    >
      <Text style={styles.closeX}>✕</Text>
    </Pressable>
  ) : null;

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="slide"
      onRequestClose={dismissable ? onClose : () => {}}
    >
      <View style={styles.backdrop} testID={testID}>
        {dismissable ? (
          <Pressable
            style={styles.dismissArea}
            onPress={onClose}
            testID={testID ? `${testID}-backdrop` : undefined}
          />
        ) : (
          <View style={styles.dismissArea} />
        )}
        <Animated.View
          style={[
            styles.card,
            size === 'half' && styles.sizeHalf,
            size === 'tall' && styles.sizeTall,
            !size && styles.sizeAuto,
            { transform: [{ translateY }] },
          ]}
        >
          {/* PanResponder lives here only — content area scrolls freely */}
          <View style={styles.grabberRow} {...panResponder.panHandlers}>
            <View style={styles.grabberPill} />
          </View>
          {showHeader && (
            <View style={styles.header}>
              <Text style={styles.title}>{title ?? ''}</Text>
              {headerRight ?? closeButton}
            </View>
          )}
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.4)',
    justifyContent: 'flex-end',
  },
  dismissArea: { flex: 1 },
  card: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxl,
    ...shadows.sheet,
  },
  sizeHalf: { height: '50%' },
  sizeTall: { height: '85%' },
  sizeAuto: { maxHeight: '90%' },
  grabberRow: {
    alignItems: 'center',
    paddingVertical: spacing.md,
  },
  grabberPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
  closeX: {
    fontSize: 22,
    color: colors.textTertiary,
  },
});
