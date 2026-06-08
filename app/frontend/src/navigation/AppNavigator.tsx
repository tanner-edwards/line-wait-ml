// Bottom-tab nav. Three tabs:
//   Home          (live wait list, filtered by daily park)
//   Recommendations (LLM picks; respects persona + daily park)
//   Profile       (edit persona, debug reset)

import React from 'react';
import { Platform } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { Home as HomeIcon, Sparkles, User } from 'lucide-react-native';
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
          tabBarIcon: ({ color }) => <HomeIcon size={22} color={color} />,
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
          tabBarIcon: ({ color }) => <User size={22} color={color} />,
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
