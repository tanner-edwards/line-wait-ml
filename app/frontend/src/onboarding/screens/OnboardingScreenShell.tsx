// Shared layout shell for every onboarding step.
//
//   ← Back (top-left, only when stack has history)
//   ProgressDots
//   ─────────────
//   Title (Lora display, large)
//   Optional subtitle
//   {children}
//   ─────────────
//   [ full-width bottom button ]

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
import { colors, radius, spacing, typography } from '../../theme/tokens';

interface Props {
  step: number;
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
    backgroundColor: colors.bg,
  },
  topBar: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.base,
    paddingTop: spacing.xs,
  },
  backButton: {
    width: 44,
    height: 44,
    alignItems: 'flex-start',
    justifyContent: 'center',
  },
  backIcon: {
    fontSize: 24,
    color: colors.textSecondary,
    paddingHorizontal: 8,
  },
  scroll: {
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.base,
    flexGrow: 1,
  },
  title: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    marginTop: spacing.sm,
    marginBottom: spacing.sm,
  },
  subtitle: {
    ...typography.body,
    color: colors.textSecondary,
    marginBottom: spacing.xl,
  },
  content: {
    flex: 1,
  },
  footer: {
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    paddingBottom: spacing.lg,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  bottomButton: {
    width: '100%',
    backgroundColor: colors.brand,
    paddingVertical: spacing.base,
    borderRadius: radius.card,
    alignItems: 'center',
  },
  bottomButtonDisabled: {
    backgroundColor: colors.textTertiary,
  },
  bottomButtonPressed: {
    opacity: 0.85,
  },
  bottomButtonText: {
    color: colors.textInverse,
    fontSize: 16,
    fontWeight: '600',
  },
});
