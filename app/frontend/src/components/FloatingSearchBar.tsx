// A search field that floats above the tab bar (Liquid-Glass-style dock)
// instead of living in the header or list content — costs no permanent
// vertical space. Home.tsx drives `visible` from scroll direction: hides on
// scroll-down, reappears on scroll-up or at the top of the list.

import React, { useEffect, useRef } from 'react';
import { Animated, KeyboardAvoidingView, Platform, StyleSheet } from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { SearchField } from './SearchField';
import { colors, radius, shadows, spacing } from '../theme/tokens';

interface Props {
  value: string;
  onChangeText: (next: string) => void;
  visible: boolean;
  placeholder?: string;
  testID?: string;
}

export function FloatingSearchBar({ value, onChangeText, visible, placeholder, testID }: Props): React.ReactElement {
  const anim = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: visible ? 1 : 0,
      duration: 200,
      useNativeDriver: true,
    }).start();
  }, [visible, anim]);

  return (
    <KeyboardAvoidingView
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      style={styles.dock}
      pointerEvents={visible ? 'box-none' : 'none'}
    >
      {/* Soft scrim behind the bar — darkens the area it floats over so the
          bar pops by contrast with its surroundings, not by being loud itself. */}
      <Animated.View style={[styles.scrim, { opacity: anim }]} pointerEvents="none">
        <LinearGradient
          colors={['transparent', 'rgba(0,0,0,0.12)']}
          style={StyleSheet.absoluteFill}
        />
      </Animated.View>

      <Animated.View
        style={[
          styles.bar,
          {
            opacity: anim,
            transform: [
              {
                translateY: anim.interpolate({
                  inputRange: [0, 1],
                  outputRange: [BAR_HEIGHT + spacing.base, 0],
                }),
              },
            ],
          },
        ]}
      >
        <SearchField
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder ?? 'Search rides…'}
          testID={testID}
          containerStyle={styles.field}
        />
      </Animated.View>
    </KeyboardAvoidingView>
  );
}

const BAR_HEIGHT = 44;
// Tall enough to fade in well above the bar's top edge, so the darkening
// reads as a gradual vignette rather than a hard-edged band.
const SCRIM_HEIGHT = 110;

const styles = StyleSheet.create({
  dock: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: SCRIM_HEIGHT,
  },
  bar: {
    marginHorizontal: spacing.base,
    marginBottom: spacing.md,
    borderRadius: radius.pill,
    ...shadows.sheet,
    // Override the shared shadow token's brand-green tint with the cream
    // background color — local to this component, not the shared token
    // (shadows.sheet is used elsewhere for its default green tint).
    shadowColor: colors.bg,
  },
  field: {
    borderRadius: radius.pill,
    borderColor: colors.borderStrong,
  },
});
