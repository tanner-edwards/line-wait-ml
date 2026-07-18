// Shared bottom-sheet primitive, backed by @gorhom/bottom-sheet v5
// (react-native-reanimated + react-native-gesture-handler). The drag runs on
// the native/UI thread, so the whole sheet body follows the finger and
// dismisses with real velocity physics — a plain PanResponder can't wrestle a
// drag away from a native ScrollView, which is why the old implementation
// could only dismiss from the grab handle.
//
// The public API (SheetProps) is intentionally unchanged from the old
// PanResponder version so call sites don't move. Requires
// <GestureHandlerRootView> + <BottomSheetModalProvider> at the app root
// (wired in App.tsx).
//
// Scrollable children MUST use the gorhom scroll primitives
// (BottomSheetScrollView / BottomSheetFlatList) for drag-to-dismiss to
// coordinate with scrolling. A plain RN ScrollView/FlatList still renders and
// scrolls, but body-drag-to-dismiss won't work until it's swapped.

import React, { useCallback, useEffect, useMemo, useRef } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import {
  BottomSheetModal,
  BottomSheetView,
  BottomSheetBackdrop,
  BottomSheetBackdropProps,
  BottomSheetFooter,
  BottomSheetFooterProps,
} from '@gorhom/bottom-sheet';
import { X } from 'lucide-react-native';
import { colors, spacing } from '../theme/tokens';

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
   * Fixed-height preset. Omit to size the sheet to its content (dynamic).
   * half ≈ 50%  |  tall ≈ 85%  |  xtall ≈ 86%
   */
  size?: 'half' | 'tall' | 'xtall';
  title?: string;
  /** Replaces the default close ✕ button when provided. */
  headerRight?: React.ReactNode;
  /** Optional content pinned to the left of the grab handle (e.g. a refresh
   *  spinner). Lives in the non-scrolling handle, so it never shifts the body. */
  headerLeft?: React.ReactNode;
  /**
   * Pinned footer rendered below the content (stays put while the body
   * scrolls, and rides above the keyboard). Use for action rows like
   * Cancel/Save.
   */
  footer?: React.ReactNode;
  children: React.ReactNode;
  testID?: string;
}

const SNAP_FOR_SIZE: Record<NonNullable<SheetProps['size']>, string> = {
  half: '50%',
  tall: '85%',
  xtall: '86%',
};



export function Sheet({
  isOpen,
  onClose,
  dismissable = true,
  backdropColor,
  sheetColor,
  size,
  title,
  headerRight,
  headerLeft,
  footer,
  children,
  testID,
}: SheetProps): React.ReactElement {
  const ref = useRef<BottomSheetModal>(null);

  // Bridge the declarative `isOpen` prop to gorhom's imperative
  // present()/dismiss(). `presented` tracks whether the sheet is currently
  // shown so we only act on real transitions (never dismiss a sheet that was
  // never presented — doing so poisons gorhom's internal state). `isOpenRef`
  // lets onDismiss tell a user-initiated close (parent still thinks it's open
  // → propagate via onClose) from a programmatic one (parent already closed
  // it → don't double-fire).
  const presented = useRef(false);
  const isOpenRef = useRef(isOpen);
  isOpenRef.current = isOpen;

  useEffect(() => {
    if (isOpen && !presented.current) {
      presented.current = true;
      ref.current?.present();
    } else if (!isOpen && presented.current) {
      presented.current = false;
      ref.current?.dismiss();
    }
  }, [isOpen]);

  const handleDismiss = useCallback(() => {
    presented.current = false;
    // Only propagate when the parent still believes it's open — that's a
    // user swipe/backdrop dismiss. Programmatic closes already set isOpen=false.
    if (isOpenRef.current) onClose();
  }, [onClose]);

  const snapPoints = useMemo(
    () => (size ? [SNAP_FOR_SIZE[size]] : undefined),
    [size],
  );

  const renderFooter = useCallback(
    (props: BottomSheetFooterProps) => (
      <BottomSheetFooter {...props}>{footer}</BottomSheetFooter>
    ),
    [footer],
  );

  const renderBackdrop = useCallback(
    (props: BottomSheetBackdropProps) => (
      <BottomSheetBackdrop
        {...props}
        appearsOnIndex={0}
        disappearsOnIndex={-1}
        pressBehavior={dismissable ? 'close' : 'none'}
        opacity={backdropColor === 'transparent' ? 0 : 0.4}
        style={[props.style, backdropColor && backdropColor !== 'transparent'
          ? { backgroundColor: backdropColor }
          : undefined]}
      />
    ),
    [dismissable, backdropColor],
  );

  const rightSlot = headerRight ?? (dismissable ? (
    <Pressable
      onPress={onClose}
      hitSlop={12}
      testID={testID ? `${testID}-close` : undefined}
    >
      <X size={18} color={colors.textTertiary} />
    </Pressable>
  ) : null);

  // Grabber + optional title live in the (draggable) handle, so the title
  // stays pinned above scrolling content.
  const renderHandle = useCallback(
    () => (
      <View>
        <View style={styles.grabberRow}>
          <View style={styles.grabberSideLeft}>{headerLeft}</View>
          <View style={styles.grabberPill} />
          <View style={styles.grabberSide}>{rightSlot}</View>
        </View>
        {title ? (
          <View style={styles.titleRow}>
            <Text style={styles.title}>{title}</Text>
          </View>
        ) : null}
      </View>
    ),
    [rightSlot, headerLeft, title],
  );

  return (
    <BottomSheetModal
      ref={ref}
      snapPoints={snapPoints}
      enableDynamicSizing={!size}
      enablePanDownToClose={dismissable}
      keyboardBehavior="interactive"
      keyboardBlurBehavior="restore"
      onDismiss={handleDismiss}
      handleComponent={renderHandle}
      backdropComponent={renderBackdrop}
      footerComponent={footer ? renderFooter : undefined}
      backgroundStyle={{ backgroundColor: sheetColor ?? colors.bg }}
    >
      {/* Fixed-height sheets: render the child scroll container
          (BottomSheetScrollView / BottomSheetFlatList) directly so gorhom can
          coordinate its scrolling with the drag gesture — wrapping it in a
          BottomSheetView breaks scroll. Those call sites own their horizontal
          padding. Dynamic (content-height) sheets wrap in a padded
          BottomSheetView so gorhom can measure them. */}
      {size ? (
        children
      ) : (
        <BottomSheetView style={styles.contentAuto}>{children}</BottomSheetView>
      )}
    </BottomSheetModal>
  );
}

const styles = StyleSheet.create({
  contentAuto: {
    paddingHorizontal: spacing.base,
    paddingBottom: spacing.xxl,
  },
  grabberRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingTop: spacing.md,
    paddingHorizontal: spacing.base,
  },
  grabberSide: {
    flex: 1,
    alignItems: 'flex-end',
  },
  grabberSideLeft: {
    flex: 1,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  grabberPill: {
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.borderStrong,
  },
  titleRow: {
    marginBottom: spacing.md,
    paddingHorizontal: spacing.base,
    marginTop: spacing.md,
  },
  title: {
    fontSize: 22,
    fontWeight: '700',
    color: colors.textPrimary,
  },
});
