// Bottom-tab nav. Two tabs:
//   ★ Recommendations  (default, inline-expand list — no detail stack)
//   ≡ Browse           (existing v0/v1 list, demoted from default)
//
// Tab bar height/padding is bumped above defaults so the icons sit a
// little farther up from the home indicator / bottom edge — easier to tap.

import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Home } from '../screens/Home';
import { Recommendations } from '../screens/Recommendations';

const Tab = createBottomTabNavigator();

export function AppNavigator(): React.ReactElement {
  return (
    <Tab.Navigator
      initialRouteName="Recommendations"
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabBarItem,
      }}
    >
      <Tab.Screen
        name="Recommendations"
        component={Recommendations}
        options={{
          tabBarIcon: ({ color }) => <TabIcon glyph="★" color={color} />,
        }}
      />
      <Tab.Screen
        name="Browse"
        component={Home}
        options={{
          tabBarIcon: ({ color }) => <TabIcon glyph="≡" color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={[styles.icon, { color }]}>{glyph}</Text>;
}

// React Navigation respects safe-area insets automatically, so we don't add
// paddingBottom manually (that'd double-count on devices with a home indicator).
// What we DO add is extra height + paddingTop so the icons sit above the
// safe-area inset instead of crowding it.
const styles = StyleSheet.create({
  tabBar: {
    height: Platform.OS === 'ios' ? 92 : 72,
    paddingTop: 10,
  },
  tabBarItem: {
    paddingVertical: 4,
    paddingBottom: 15,
  },
  icon: { fontSize: 22, lineHeight: 24 },
});
