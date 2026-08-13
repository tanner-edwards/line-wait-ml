// FeedbackScreen — beta feedback form, opened as a formSheet Modal from
// Profile. All 5 ratings + notes + the overall free-text field are optional;
// submit is always enabled. tripId is resolved server-side, not sent here.

import React, { useState } from 'react';
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { ChevronLeft, CheckCircle2 } from 'lucide-react-native';
import { submitFeedback } from '../api';
import { useAuth } from '../context/AuthContext';
import { FeedbackQuestion, FeedbackQuestionOption } from '../components/FeedbackQuestion';
import { Card } from '../components/Card';
import { colors, radius, shadows, spacing, typography } from '../theme/tokens';

interface FeedbackScreenProps {
  onClose: () => void;
}

type QuestionKey =
  | 'predictionTrust'
  | 'clarity'
  | 'usability'
  | 'outcomeImpact'
  | 'repeatIntent';

interface QuestionConfig {
  key: QuestionKey;
  question: string;
  options: FeedbackQuestionOption[];
}

const QUESTIONS: QuestionConfig[] = [
  {
    key: 'predictionTrust',
    question: "How often did the app's guidance turn out to be right?",
    options: [
      { value: 1, label: 'Rarely right' },
      { value: 2, label: 'Occasionally right' },
      { value: 3, label: 'Right about half the time' },
      { value: 4, label: 'Right most of the time' },
      { value: 5, label: 'Right almost every time' },
    ],
  },
  {
    key: 'clarity',
    question: 'How often did you know what to do next without having to think about it?',
    options: [
      { value: 1, label: 'Rarely' },
      { value: 2, label: 'Occasionally' },
      { value: 3, label: 'About half the time' },
      { value: 4, label: 'Most of the time' },
      { value: 5, label: 'Every time' },
    ],
  },
  {
    key: 'usability',
    question: 'How easy was the app itself to use — navigating, finding things, tapping around?',
    options: [
      { value: 1, label: 'Frustrating' },
      { value: 2, label: 'Clunky' },
      { value: 3, label: 'Fine' },
      { value: 4, label: 'Smooth' },
      { value: 5, label: 'Effortless' },
    ],
  },
  {
    key: 'outcomeImpact',
    question: 'Did the app change what you decided to do at any point today?',
    options: [
      { value: 1, label: 'Never' },
      { value: 2, label: 'Rarely' },
      { value: 3, label: 'Sometimes' },
      { value: 4, label: 'Often' },
      { value: 5, label: 'Constantly' },
    ],
  },
  {
    key: 'repeatIntent',
    question: 'Would you use this again on your next trip?',
    options: [
      { value: 1, label: 'Definitely not' },
      { value: 2, label: 'Probably not' },
      { value: 3, label: 'Maybe' },
      { value: 4, label: 'Probably' },
      { value: 5, label: 'Definitely' },
    ],
  },
];

export function FeedbackScreen({ onClose }: FeedbackScreenProps): React.ReactElement {
  const { getIdToken } = useAuth();

  const [ratings, setRatings] = useState<Record<QuestionKey, number | null>>({
    predictionTrust: null,
    clarity: null,
    usability: null,
    outcomeImpact: null,
    repeatIntent: null,
  });
  const [notes, setNotes] = useState<Record<QuestionKey, string>>({
    predictionTrust: '',
    clarity: '',
    usability: '',
    outcomeImpact: '',
    repeatIntent: '',
  });
  const [noteExpanded, setNoteExpanded] = useState<Record<QuestionKey, boolean>>({
    predictionTrust: false,
    clarity: false,
    usability: false,
    outcomeImpact: false,
    repeatIntent: false,
  });
  const [overallFreeText, setOverallFreeText] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  const handleSubmit = async () => {
    setSubmitting(true);
    try {
      const token = await getIdToken();
      if (!token) throw new Error('Not signed in');
      await submitFeedback(token, {
        predictionTrust: ratings.predictionTrust,
        predictionTrustNote: notes.predictionTrust.trim() || null,
        clarity: ratings.clarity,
        clarityNote: notes.clarity.trim() || null,
        usability: ratings.usability,
        usabilityNote: notes.usability.trim() || null,
        outcomeImpact: ratings.outcomeImpact,
        outcomeImpactNote: notes.outcomeImpact.trim() || null,
        repeatIntent: ratings.repeatIntent,
        repeatIntentNote: notes.repeatIntent.trim() || null,
        overallFreeText: overallFreeText.trim() || null,
      });
      setSubmitted(true);
      setTimeout(onClose, 1500);
    } catch (err) {
      Alert.alert('Something went wrong', err instanceof Error ? err.message : 'Please try again.');
      setSubmitting(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.keyboardAvoid}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <SafeAreaView style={styles.container}>
        <View style={styles.header}>
          <TouchableOpacity onPress={onClose} style={styles.closeBtn} hitSlop={12}>
            <ChevronLeft size={22} color={colors.textSecondary} />
          </TouchableOpacity>
        </View>

        {submitted ? (
          <View style={styles.successContainer}>
            <CheckCircle2 size={40} color={colors.go} />
            <Text style={styles.successText}>Thanks for the feedback</Text>
          </View>
        ) : (
          <ScrollView
            contentContainerStyle={styles.scroll}
            showsVerticalScrollIndicator={false}
            automaticallyAdjustKeyboardInsets
            keyboardShouldPersistTaps="handled"
          >
            <Text style={styles.eyebrow}>Beta Feedback</Text>
            <Text style={styles.headline}>Help us improve Club 32</Text>

            {QUESTIONS.map((config, i) => (
              <FeedbackQuestion
                key={config.key}
                index={i + 1}
                total={QUESTIONS.length}
                question={config.question}
                options={config.options}
                selected={ratings[config.key]}
                onSelect={value => setRatings(r => ({ ...r, [config.key]: value }))}
                noteExpanded={noteExpanded[config.key]}
                onToggleNote={() => setNoteExpanded(n => ({ ...n, [config.key]: !n[config.key] }))}
                noteValue={notes[config.key]}
                onNoteChange={text => setNotes(n => ({ ...n, [config.key]: text }))}
              />
            ))}

            <Card style={styles.freeTextSection}>
              <Text style={styles.question}>Anything else you want to tell us?</Text>
              <TextInput
                style={styles.freeTextInput}
                value={overallFreeText}
                onChangeText={setOverallFreeText}
                placeholder="Optional"
                placeholderTextColor={colors.textTertiary}
                multiline
              />
            </Card>

            <Pressable
              style={({ pressed }) => [styles.submitBtn, pressed && styles.submitBtnPressed]}
              onPress={() => void handleSubmit()}
              disabled={submitting}
            >
              <Text style={styles.submitBtnText}>{submitting ? 'Submitting…' : 'Submit feedback'}</Text>
            </Pressable>
          </ScrollView>
        )}
      </SafeAreaView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  keyboardAvoid: { flex: 1, backgroundColor: colors.bg },
  container: { flex: 1 },
  header: {
    paddingHorizontal: spacing.base,
    paddingTop: spacing.sm,
    paddingBottom: spacing.xs,
  },
  closeBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
  },
  scroll: {
    paddingHorizontal: spacing.xl,
    paddingBottom: spacing.xxxl,
  },
  eyebrow: {
    ...typography.badge,
    color: colors.brand,
    textTransform: 'uppercase',
    letterSpacing: 1,
    marginTop: spacing.sm,
  },
  headline: {
    ...typography.screenTitle,
    color: colors.textPrimary,
    marginBottom: spacing.xl,
  },
  question: {
    fontFamily: 'Lora_600SemiBold',
    fontSize: 19,
    fontWeight: '600',
    letterSpacing: -0.19,
    color: colors.textPrimary,
    marginBottom: spacing.md,
  },
  freeTextSection: {
    marginBottom: spacing.xl,
    padding: spacing.lg,
  },
  freeTextInput: {
    backgroundColor: colors.surface,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.borderStrong,
    paddingHorizontal: spacing.base,
    paddingVertical: spacing.sm,
    minHeight: 80,
    textAlignVertical: 'top',
    ...typography.body,
    color: colors.textPrimary,
  },
  submitBtn: {
    backgroundColor: colors.brand,
    borderRadius: radius.md,
    paddingVertical: 16,
    alignItems: 'center',
    ...shadows.card,
  },
  submitBtnPressed: {
    opacity: 0.85,
  },
  submitBtnText: {
    ...typography.label,
    fontSize: 16,
    color: colors.textInverse,
    fontWeight: '700',
  },
  successContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.md,
  },
  successText: {
    ...typography.cardTitle,
    color: colors.textPrimary,
  },
});
