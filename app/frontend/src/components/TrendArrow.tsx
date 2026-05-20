import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export interface TrendArrowProps {
  bucket0Wait: number | null;
  bucket2Wait: number | null;
  /**
   * When true, the arrow renders with a subtle "this is a low-confidence
   * estimate" treatment (dashed border around the glyph). The arrow direction
   * itself is unchanged — we just hint that the historical curve underlying
   * the direction is built on thin data.
   *
   * We use a dashed border rather than a trailing "·" or opacity tweak
   * because:
   *   - A trailing dot can be confused for punctuation in the wait row.
   *   - Lower opacity can read as "disabled" rather than "estimate."
   *   - A dashed border around the glyph reads as "approximate" without
   *     changing the meaning of the arrow itself, and it's small enough to
   *     stay tidy in a tight right-aligned column.
   */
  lowConfidence: boolean;
}

/**
 * Renders a tiny direction-of-change indicator next to a ride's current wait,
 * comparing the historical-average bucket at t+0 (`bucket0Wait`) to the
 * historical-average bucket at t+60 (`bucket2Wait`) — i.e. how a typical
 * same-day-type's wait curve moves over the next hour.
 *
 * Render rules (from the v1 spec — keep these in sync if the spec moves):
 *   - If `bucket0Wait` or `bucket2Wait` is null, OR `bucket0Wait === 0`:
 *     render nothing. (`bucket0Wait === 0` would zero-divide the comparison
 *     and we can't say anything useful anyway.)
 *   - Green ↓ when `bucket2Wait < bucket0Wait * 0.9`.
 *   - Red   ↑ when `bucket2Wait > bucket0Wait * 1.1`.
 *   - Gray  → (stable) when within ±10%.
 *   - When `lowConfidence` is true, the arrow renders with a dashed border.
 *
 * Plain text glyphs (↓ ↑ →) — no image assets, no font loading.
 */
export function TrendArrow({
  bucket0Wait,
  bucket2Wait,
  lowConfidence,
}: TrendArrowProps): React.ReactElement | null {
  if (bucket0Wait === null || bucket2Wait === null || bucket0Wait === 0) {
    return null;
  }

  let glyph: '↘' | '↗' | '→';
  let colorStyle;
  let direction: 'down' | 'up' | 'stable';
  if (bucket2Wait < bucket0Wait * 0.9) {
    glyph = '↘';
    colorStyle = styles.down;
    direction = 'down';
  } else if (bucket2Wait > bucket0Wait * 1.1) {
    glyph = '↗';
    colorStyle = styles.up;
    direction = 'up';
  } else {
    glyph = '→';
    colorStyle = styles.stable;
    direction = 'stable';
  }

  return (
    <View
      style={[styles.container, lowConfidence && styles.lowConfidence]}
      testID={`trend-arrow-${direction}${lowConfidence ? '-low-conf' : ''}`}
    >
      <Text style={[styles.glyph, colorStyle]}>{glyph}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    marginLeft: 6,
    paddingHorizontal: 3,
    paddingVertical: 0,
    borderRadius: 4,
    borderWidth: 1,
    borderColor: 'transparent',
    alignItems: 'center',
    justifyContent: 'center',
  },
  lowConfidence: {
    borderStyle: 'dashed',
    borderColor: '#bbb',
  },
  glyph: {
    fontSize: 14,
    fontWeight: '700',
    lineHeight: 16,
  },
  // Colors picked to read clearly on the app's light (#fff) background.
  down: { color: '#1a7f37' }, // green
  up: { color: '#c41e3a' }, // red
  stable: { color: '#666' }, // gray
});
