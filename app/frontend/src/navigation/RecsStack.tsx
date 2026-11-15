// Recommendations tab: a small stack so More to Consider can push on top of
// the main screen (back chevron, tab bar stays). RecsProvider wraps both so
// they share one rec list.

import React from 'react';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { RecsProvider } from '../context/RecsContext';
import { colors } from '../theme/tokens';
import { Recommendations } from '../screens/Recommendations';
import { MoreToConsider } from '../screens/MoreToConsider';

export type RecsStackParamList = {
  RecommendationsHome: undefined;
  MoreToConsider: undefined;
};

const Stack = createNativeStackNavigator<RecsStackParamList>();

export function RecsStack(): React.ReactElement {
  return (
    <RecsProvider>
      <Stack.Navigator screenOptions={{ headerShown: false, contentStyle: { backgroundColor: colors.bg } }}>
        <Stack.Screen name="RecommendationsHome" component={Recommendations} />
        <Stack.Screen name="MoreToConsider" component={MoreToConsider} />
      </Stack.Navigator>
    </RecsProvider>
  );
}
