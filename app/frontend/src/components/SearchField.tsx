import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { Search, X } from 'lucide-react-native';
import { colors } from '../theme/tokens';

interface Props {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  testID?: string;
  containerStyle?: object;
  /** Defaults to the muted textTertiary used everywhere else this field
   *  appears (onboarding, persona edit) — override for contexts that need
   *  the field to stand out more, e.g. the floating bar on Home. */
  iconColor?: string;
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
  testID,
  containerStyle,
  iconColor = colors.textTertiary,
}: Props): React.ReactElement {
  return (
    <View style={[styles.container, containerStyle]}>
      <Search size={16} color={iconColor} style={styles.searchIcon} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.textTertiary}
        style={styles.input}
        autoCorrect={false}
        autoCapitalize="none"
        testID={testID}
      />
      {value.length > 0 && (
        <Pressable
          onPress={() => onChangeText('')}
          style={styles.clearButton}
          hitSlop={8}
          testID={testID ? `${testID}-clear` : undefined}
        >
          <X size={13} color={colors.textInverse} strokeWidth={3} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1.5,
    borderColor: colors.border,
    paddingHorizontal: 14,
  },
  searchIcon: {
    marginRight: 8,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: colors.textPrimary,
  },
  clearButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: colors.borderStrong,
  },
});
