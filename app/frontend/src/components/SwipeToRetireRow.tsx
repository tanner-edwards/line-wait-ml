// Swipe-left-to-retire wrapper for a recommendation card. Reveals a single
// "Rode it" action panel on the right; confirming it marks the ride retired
// for the rest of the trip (see DeviceContext.retireRide).
//
// Discoverability is a one-time peek animation on the very first card ever
// shown. The card sits flush at rest — the old persistent colored edge hint
// read as a mystery stripe and was removed in the UX redesign.

import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  runOnJS,
  useAnimatedStyle,
  useSharedValue,
  withSequence,
  withSpring,
  withTiming,
} from 'react-native-reanimated';
import { RodeItCheckmark } from './RodeItCheckmark';
import { fonts, radius, retiredAction, retiredActionText, spacing } from '../theme/tokens';
import { getSwipeHintShown, setSwipeHintShown } from '../utils/swipeHintStorage';

const REST_X = 0;
const ACTION_WIDTH = 100;
const PEEK_WIDTH = 60;
const OPEN_THRESHOLD = -(ACTION_WIDTH / 2);

interface SwipeToRetireRowProps {
  children: React.ReactNode;
  onConfirm: () => void;
  /** Only the very first card in the list plays the one-time peek animation. */
  isFirst?: boolean;
  testID?: string;
}

export function SwipeToRetireRow({
  children,
  onConfirm,
  isFirst,
  testID,
}: SwipeToRetireRowProps): React.ReactElement {
  const translateX = useSharedValue(REST_X);
  const startX = useSharedValue(REST_X);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!isFirst) return;
    let cancelled = false;
    void getSwipeHintShown().then(shown => {
      if (shown || cancelled) return;
      translateX.value = withSequence(
        withTiming(-PEEK_WIDTH, { duration: 260 }),
        withTiming(REST_X, { duration: 260 })
      );
      void setSwipeHintShown();
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isFirst]);

  const handleConfirm = () => {
    opacity.value = withTiming(0, { duration: 200 }, finished => {
      if (finished) runOnJS(onConfirm)();
    });
  };

  const panGesture = Gesture.Pan()
    .activeOffsetX([-10, 10])
    .failOffsetY([-15, 15])
    .onStart(() => {
      startX.value = translateX.value;
    })
    .onUpdate(e => {
      const next = startX.value + e.translationX;
      translateX.value = Math.min(REST_X, Math.max(-ACTION_WIDTH, next));
    })
    .onEnd(e => {
      const shouldOpen = translateX.value < OPEN_THRESHOLD || e.velocityX < -500;
      translateX.value = withSpring(shouldOpen ? -ACTION_WIDTH : REST_X, {
        damping: 20,
        stiffness: 220,
      });
    });

  // Hide the action panel at rest so no blue bleeds around the card's
  // rounded corners; it appears as soon as the card moves.
  const actionStyle = useAnimatedStyle(() => ({
    opacity: translateX.value < REST_X ? 1 : 0,
  }));

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.wrapper} testID={testID}>
      <Animated.View style={[styles.actionBackground, actionStyle]}>
        <Pressable
          style={styles.actionPanel}
          onPress={handleConfirm}
          testID={testID ? `${testID}-confirm` : undefined}
        >
          <RodeItCheckmark size={26} color={retiredActionText} />
          <Text style={styles.actionLabel}>Rode it</Text>
        </Pressable>
      </Animated.View>
      <GestureDetector gesture={panGesture}>
        <Animated.View style={frontStyle}>{children}</Animated.View>
      </GestureDetector>
    </View>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'relative',
  },
  actionBackground: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: retiredAction,
    borderRadius: radius.card,
    overflow: 'hidden',
    flexDirection: 'row',
    justifyContent: 'flex-end',
  },
  actionPanel: {
    width: ACTION_WIDTH,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
  },
  actionLabel: {
    fontFamily: fonts.displaySemiBold,
    fontSize: 15,
    color: retiredActionText,
  },
});
