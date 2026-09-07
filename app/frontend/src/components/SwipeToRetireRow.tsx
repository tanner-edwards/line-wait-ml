// Swipe-left-to-retire wrapper for a recommendation card. Reveals a single
// "Rode it" action panel on the right; confirming it marks the ride retired
// for the rest of the trip (see DeviceContext.retireRide).
//
// Two discoverability requirements from the spec, both always-on (not
// gesture-dependent): a persistent colored edge hint at rest, and a
// one-time peek animation on the very first card ever shown.

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

const EDGE_HINT_WIDTH = 6;
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
  const translateX = useSharedValue(-EDGE_HINT_WIDTH);
  const startX = useSharedValue(-EDGE_HINT_WIDTH);
  const opacity = useSharedValue(1);

  useEffect(() => {
    if (!isFirst) return;
    let cancelled = false;
    void getSwipeHintShown().then(shown => {
      if (shown || cancelled) return;
      translateX.value = withSequence(
        withTiming(-PEEK_WIDTH, { duration: 260 }),
        withTiming(-EDGE_HINT_WIDTH, { duration: 260 })
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
      translateX.value = Math.min(-EDGE_HINT_WIDTH, Math.max(-ACTION_WIDTH, next));
    })
    .onEnd(e => {
      const shouldOpen = translateX.value < OPEN_THRESHOLD || e.velocityX < -500;
      translateX.value = withSpring(shouldOpen ? -ACTION_WIDTH : -EDGE_HINT_WIDTH, {
        damping: 20,
        stiffness: 220,
      });
    });

  const frontStyle = useAnimatedStyle(() => ({
    transform: [{ translateX: translateX.value }],
    opacity: opacity.value,
  }));

  return (
    <View style={styles.wrapper} testID={testID}>
      <View style={styles.actionBackground}>
        <Pressable
          style={styles.actionPanel}
          onPress={handleConfirm}
          testID={testID ? `${testID}-confirm` : undefined}
        >
          <RodeItCheckmark size={26} color={retiredActionText} />
          <Text style={styles.actionLabel}>Rode it</Text>
        </Pressable>
      </View>
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
