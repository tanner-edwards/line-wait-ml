// Shared layout for every onboarding question screen.
//
//   ← Back (top-left, only when stack has history)
//   ProgressDots
//   ─────────────
//   Title (large)
//   Optional subtitle
//   {children}                      ← question content (typically rows)
//   ─────────────
//   [ full-width bottom button ]    ← Skip / Continue / etc.
//
// For single-select questions the parent typically auto-advances on tap and
// the bottom button stays as "Skip" the whole time. For multi-select the
// parent flips the label to "Continue" once a selection exists.

import React from 'react';
import {
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useNavigation } from '@react-navigation/native';
import { ProgressDots } from '../ProgressDots';

interface Props {
  step: number;        // 0-indexed
  total: number;
  title: string;
  subtitle?: string;
  bottomLabel: string;
  onBottomPress: () => void;
  bottomDisabled?: boolean;
  children: React.ReactNode;
}

export function OnboardingScreenShell({
  step,
  total,
  title,
  subtitle,
  bottomLabel,
  onBottomPress,
  bottomDisabled,
  children,
}: Props): React.ReactElement {
  const nav = useNavigation();

  return (
    <SafeAreaView style={styles.container}>
      <View style={styles.topBar}>
        {nav.canGoBack() ? (
          <Pressable onPress={() => nav.goBack()} testID="onboarding-back" style={styles.backButton}>
            <Text style={styles.backIcon}>←</Text>
          </Pressable>
        ) : (
          <View style={styles.backButton} />
        )}
        <ProgressDots total={total} current={step} />
        <View style={styles.backButton} />
      </View>

      <ScrollView contentContainerStyle={styles.scroll} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>{title}</Text>
        {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
        <View style={styles.content}>{children}</View>
      </ScrollView>

      <View style={styles.footer}>
        <Pressable
          onPress={onBottomPress}
          disabled={bottomDisabled}
          style={({ pressed }) => [
            styles.bottomButton,
            bottomDisabled && styles.bottomButtonDisabled,
            pressed && styles.bottomButtonPressed,
          ]}
          testID="onboarding-bottom-button"
        >
          <Text style={styles.bottomButtonText}>{bottomLabel}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 4,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 24,
    color: '#444',
    paddingHorizontal: 8,
  },
  scroll: {
    paddingHorizontal: 20,
    paddingBottom: 16,
    flexGrow: 1,
  },
  title: {
    fontSize: 26,
    fontWeight: '700',
    color: '#111',
    marginTop: 8,
    marginBottom: 6,
  },
  subtitle: {
    fontSize: 14,
    color: '#666',
    marginBottom: 24,
    lineHeight: 20,
  },
  content: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 20,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  bottomButton: {
    width: '100%',
    backgroundColor: '#222',
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  bottomButtonDisabled: {
    backgroundColor: '#bbb',
  },
  bottomButtonPressed: {
    opacity: 0.85,
  },
  bottomButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
