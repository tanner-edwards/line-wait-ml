// Bottom-tab nav. Three tabs:
//   Home          (live wait list, filtered by daily park)
//   Recommendations (LLM picks; respects persona + daily park)
//   Profile       (edit persona, debug reset)

import React from 'react';
import { Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Home as HomeIcon, Sparkles, User } from 'lucide-react-native';
import Svg, { Path } from 'react-native-svg';
import { colors } from '../theme/tokens';
import { Home } from '../screens/Home';
import { Recommendations } from '../screens/Recommendations';
import { Profile } from '../screens/Profile';

// Lucide's Home icon has two separate paths: house body + door. Filling the
// whole icon covers the door, so we render them individually — house filled,
// door painted white — to keep the door visually cut out.
function HomeTabIcon({ size, color, focused }: { size: number; color: string; focused: boolean }) {
  if (!focused) return <HomeIcon size={size} color={color} />;
  return (
    <Svg width={size} height={size} viewBox="0 0 24 24" fill="none">
      <Path
        d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"
        fill={color}
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <Path
        d="M9 22V12H15V22Z"
        fill="white"
        stroke={color}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

const Tab = createBottomTabNavigator();

export function AppNavigator(): React.ReactElement {
  return (
    <Tab.Navigator
      initialRouteName="Home"
      screenOptions={{
        headerShown: false,
        tabBarStyle: styles.tabBar,
        tabBarItemStyle: styles.tabBarItem,
        tabBarActiveTintColor: colors.brand,
        tabBarInactiveTintColor: colors.textTertiary,
      }}
    >
      <Tab.Screen
        name="Home"
        component={Home}
        options={{
          tabBarIcon: ({ color, focused }) => <HomeTabIcon size={22} color={color} focused={focused} />,
        }}
      />
      <Tab.Screen
        name="Recommendations"
        component={Recommendations}
        options={{
          tabBarIcon: ({ color, focused }) => (
            <Sparkles size={22} color={color} fill={focused ? color : 'none'} />
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
  );
}

const styles = {
  tabBar: {
    height: Platform.OS === 'ios' ? 107 : 87,
    paddingTop: 10,
  },
  tabBarItem: {
    paddingVertical: 4,
    paddingBottom: 15,
  },
};
