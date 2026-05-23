// Bottom-tab nav with two tabs, plus a stack navigator inside the
// Recommendations tab so the list → detail navigation works.
//
// Tab structure:
//   ★ Recommendations  →  Stack: RecommendationsList → RecommendationDetail
//   ≡ Browse           →  Home (existing v0/v1 list, demoted from default)

import React from 'react';
import { StyleSheet, Text } from 'react-native';
import { createBottomTabNavigator } from '@react-navigation/bottom-tabs';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { Home } from '../screens/Home';
import { Recommendations } from '../screens/Recommendations';
import { RecommendationDetail } from '../screens/RecommendationDetail';

export type RecommendationsStackParamList = {
  RecommendationsList: undefined;
  RecommendationDetail: {
    rideId: string;
    oneLiner: string;
    paragraph: string;
    walkMinutes: number | null;
  };
};

const Tab = createBottomTabNavigator();
const Stack = createNativeStackNavigator<RecommendationsStackParamList>();

function RecommendationsStack() {
  return (
    <Stack.Navigator screenOptions={{ headerShown: false }}>
      <Stack.Screen name="RecommendationsList" component={Recommendations} />
      <Stack.Screen name="RecommendationDetail" component={RecommendationDetail} />
    </Stack.Navigator>
  );
}

export function AppNavigator(): React.ReactElement {
  return (
    <Tab.Navigator
      initialRouteName="Recommendations"
      screenOptions={{ headerShown: false }}
    >
      <Tab.Screen
        name="Recommendations"
        component={RecommendationsStack}
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

const styles = StyleSheet.create({
  icon: { fontSize: 22, lineHeight: 24 },
});
