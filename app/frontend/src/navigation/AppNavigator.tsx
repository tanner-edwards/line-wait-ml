// Bottom-tab nav. Three tabs:
//   ≡  Home             (default — live wait list, filtered by daily park)
//   ★  Recommendations  (LLM picks; respects persona + daily park)
//   👤 Profile          (edit persona, debug reset)
//
// Tab bar height/padding is bumped above defaults so the icons sit a
// little farther up from the home indicator / bottom edge — easier to tap.

import React from 'react';
import { Platform, StyleSheet, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Home } from '../screens/Home';
import { Recommendations } from '../screens/Recommendations';
import { Profile } from '../screens/Profile';

const Tab = createBottomTabNavigator();

export function AppNavigator(): React.ReactElement {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabBarItem,
      }}
    >
      <Tab.Screen
        name="Home"
        component={Home}
        options={{
          tabBarIcon: ({ color }) => <TabIcon glyph="≡" color={color} />,
        }}
      />
      <Tab.Screen
        name="Recommendations"
        component={Recommendations}
        options={{
          tabBarIcon: ({ color }) => <TabIcon glyph="★" color={color} />,
        }}
      />
      <Tab.Screen
        name="Profile"
        component={Profile}
        options={{
          tabBarIcon: ({ color }) => <TabIcon glyph="👤" color={color} />,
        }}
      />
    </Tab.Navigator>
  );
}

function TabIcon({ glyph, color }: { glyph: string; color: string }) {
  return <Text style={[styles.icon, { color }]}>{glyph}</Text>;
}

const styles = StyleSheet.create({
  tabBar: {
    height: Platform.OS === 'ios' ? 107 : 87,
    paddingTop: 10,
  },
  tabBarItem: {
    paddingVertical: 4,
    paddingBottom: 15,
  },
  icon: { fontSize: 22, lineHeight: 24 },
});
