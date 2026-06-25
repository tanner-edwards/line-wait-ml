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
import { X } from 'lucide-react-native';
import { colors, radius, shadows, spacing } from '../theme/tokens';

export interface SheetProps {
  isOpen: boolean;
  onClose: () => void;
  /** When false, backdrop tap and drag-down are both disabled. Default: true. */
  dismissable?: boolean;
  /** Override the backdrop colour. Pass 'transparent' to avoid stacking overlays. */
  backdropColor?: string;
  /** Override the sheet surface colour. Defaults to colors.bg (cream). */
  sheetColor?: string;
  /**
   * Fixed-height preset. Omit to size the sheet to its content (max 90%).
   * half ≈ 50%  |  tall ≈ 85%
   * No snap-between-sizes — each preset is a single fixed height.
   */
  size?: 'half' | 'tall' | 'xtall';
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
  backdropColor,
  sheetColor,
  size,
  title,
  headerRight,
  children,
  testID,
}: SheetProps): React.ReactElement {
  const translateY = useRef(new Animated.Value(0)).current;

  // Refs so PanResponder (created once) always calls the latest callbacks.
  const onCloseRef = useRef(onClose);
  const dismissableRef = useRef(dismissable);
  onCloseRef.current = onClose;
  dismissableRef.current = dismissable;

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
        if (dismissableRef.current && (gs.dy > 80 || gs.vy > 0.8)) {
          translateY.setValue(0);
          onCloseRef.current();
        } else {
          Animated.spring(translateY, { toValue: 0, useNativeDriver: true }).start();
        }
      },
    })
  ).current;

  const rightSlot = headerRight ?? (dismissable ? (
    <Pressable
      onPress={onClose}
      hitSlop={12}
      testID={testID ? `${testID}-close` : undefined}
    >
      <X size={18} color={colors.textTertiary} />
    </Pressable>
  ) : null);

  return (
    <Modal
      visible={isOpen}
      transparent
      animationType="slide"
      onRequestClose={dismissable ? onClose : () => {}}
    >
      <View style={[styles.backdrop, backdropColor ? { backgroundColor: backdropColor } : undefined]} testID={testID}>
        {/* Absolute-fill Pressable sits behind the card. Taps on the empty
            backdrop area reach it; taps on the card don't (card is on top). */}
        {dismissable ? (
          <Pressable
            style={StyleSheet.absoluteFill}
            onPress={onClose}
            testID={testID ? `${testID}-backdrop` : undefined}
          />
        ) : null}
        <Animated.View
          style={[
            styles.card,
            size === 'half'  && styles.sizeHalf,
            size === 'tall'  && styles.sizeTall,
            size === 'xtall' && styles.sizeXTall,
            !size && styles.sizeAuto,
            { transform: [{ translateY }] },
            sheetColor ? { backgroundColor: sheetColor } : undefined,
          ]}
        >
          {/* Grabber row doubles as the close-button row — pill stays centered
              between two equal flex:1 sides; right side holds the dismiss button. */}
          <View style={styles.grabberRow} {...panResponder.panHandlers}>
            <View style={styles.grabberSide} />
            <View style={styles.grabberPill} />
            <View style={styles.grabberSide}>{rightSlot}</View>
          </View>
          {title ? (
            <View style={styles.titleRow}>
              <Text style={styles.title}>{title}</Text>
            </View>
          ) : null}
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
    // Sheets use the cream page-bg so white card-tiles inside (RideDetail
    // Tiles, DailyParkSheet rows, etc.) read as elevated surfaces, matching
    // the rest of the app's "cream background, white cards" rhythm.
    backgroundColor: colors.bg,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xxl,
    ...shadows.sheet,
  },
  sizeHalf:  { height: '50%' },
  sizeTall:  { height: '85%' },
  sizeXTall: { height: '86%' },
  sizeAuto:  { maxHeight: '90%' },
  grabberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingBottom: 0,
  },
  grabberSide: {
    flex: 1,
    alignItems: 'flex-end',
  },
  grabberPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  titleRow: {
    marginBottom: spacing.md,
  },
  title: {
    fontSize: 18,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
