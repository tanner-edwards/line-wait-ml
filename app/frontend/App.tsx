import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LocationProvider } from './src/context/LocationContext';
import { RideProvider } from './src/context/RideContext';
import { PersonaProvider } from './src/context/PersonaContext';
import { DailyContextProvider } from './src/context/DailyContextContext';
import { RootNavigator } from './src/navigation/RootNavigator';

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <PersonaProvider>
          <DailyContextProvider>
            <LocationProvider>
              <RideProvider>
                <RootNavigator />
              </RideProvider>
            </LocationProvider>
          </DailyContextProvider>
        </PersonaProvider>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
