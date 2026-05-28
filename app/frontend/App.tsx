import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LocationProvider } from './src/context/LocationContext';
import { RideProvider } from './src/context/RideContext';
import { AppNavigator } from './src/navigation/AppNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <LocationProvider>
          <RideProvider>
            <AppNavigator />
          </RideProvider>
        </LocationProvider>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
