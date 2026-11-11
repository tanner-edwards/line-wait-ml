// Bottom-tab nav. Three tabs:
//   Recommendations (LLM picks; respects persona + daily park) — default
//   Discover        (live wait list, filtered by daily park)
//   Profile         (edit persona, debug reset)

import React from 'react';
import { Platform, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Compass, Sparkles, User } from 'lucide-react-native';
import { colors } from '../theme/tokens';
import { Home } from '../screens/Home';
import { RecsStack } from './RecsStack';
import { Profile } from '../screens/Profile';

const Tab = createBottomTabNavigator();

export function AppNavigator(): React.ReactElement {
  const insets = useSafeAreaInsets();
  return (
    <View style={styles.root}>
      <Tab.Navigator
        initialRouteName="Recommendations"
        screenOptions={{
          headerShown: false,
          tabBarStyle: styles.tabBar,
          tabBarItemStyle: styles.tabBarItem,
          tabBarActiveTintColor: colors.brand,
          tabBarInactiveTintColor: colors.textTertiary,
        }}
      >
        <Tab.Screen
          name="Recommendations"
          component={RecsStack}
          options={{
            tabBarIcon: ({ color, focused }) => (
              <Sparkles size={22} color={color} fill={focused ? color : 'none'} />
            ),
          }}
        />
        <Tab.Screen
          name="Discover"
          component={Home}
          options={{
            // Compass needle is a separate path — filling would cover it, so
            // the focused state thickens the stroke instead.
            tabBarIcon: ({ color, focused }) => (
              <Compass size={22} color={color} strokeWidth={focused ? 2.5 : 2} />
            ),
          }}
        />
        <Tab.Screen
          name="Profile"
          component={Profile}
          options={{
            tabBarIcon: ({ color, focused }) => <User size={22} color={color} fill={focused ? color : 'none'} />,
          }}
        />
      </Tab.Navigator>
      {/* Paints the status-bar strip (clock/battery) header green on every
          tab, flush with GradientHeader below it. Owns the status-bar style
          for the tab screens, so they don't render their own. */}
      <View pointerEvents="none" style={[styles.statusStrip, { height: insets.top }]} />
      <StatusBar style="light" />
    </View>
  );
}

// React Navigation respects safe-area insets automatically on native, so the
// extra height + paddingBottom below is web/PWA-only — mobile browser chrome
// doesn't get that automatic inset handling, so the bar sits too close to the
// bottom there. Applying it to native as well double-counts the home
// indicator inset and pushes the bar too far up.
const styles = {
  root: { flex: 1 },
  statusStrip: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: colors.gradientFrom,
  },
  tabBar: {
    height: Platform.OS === 'web' ? 87 : Platform.OS === 'ios' ? 92 : 72,
    paddingTop: 10,
  },
  tabBarItem: {
    paddingVertical: 4,
    paddingBottom: Platform.OS === 'web' ? 15 : 0,
  },
};
