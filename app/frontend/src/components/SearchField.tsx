import React from 'react';
import { Pressable, StyleSheet, TextInput, View } from 'react-native';
import { X } from 'lucide-react-native';

interface Props {
  value: string;
  onChangeText: (next: string) => void;
  placeholder?: string;
  testID?: string;
  containerStyle?: object;
}

export function SearchField({
  value,
  onChangeText,
  placeholder,
  testID,
  containerStyle,
}: Props): React.ReactElement {
  return (
    <View style={[styles.container, containerStyle]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor="#999"
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
          <X size={13} color="#fff" strokeWidth={3} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#f4f4f7',
    borderRadius: 12,
    paddingHorizontal: 14,
  },
  input: {
    flex: 1,
    paddingVertical: 12,
    fontSize: 16,
    color: '#222',
  },
  clearButton: {
    width: 28,
    height: 28,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: 14,
    backgroundColor: '#d8d8de',
  },
});
