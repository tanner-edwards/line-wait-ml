import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { LocationProvider } from './src/context/LocationContext';
import { RideProvider } from './src/context/RideContext';
import { PersonaProvider } from './src/context/PersonaContext';
import { DeviceProvider } from './src/context/DeviceContext';
import { DailyContextProvider } from './src/context/DailyContextContext';
import { DebugModeProvider } from './src/context/DebugModeContext';
import { NotificationDetailProvider } from './src/context/NotificationDetailContext';
import { RideDetailModal } from './src/components/RideDetailModal';
import { NotificationHistorySheet } from './src/components/NotificationHistorySheet';
import { NotificationDeepLinkHandler } from './src/components/NotificationDeepLinkHandler';
import { RootNavigator } from './src/navigation/RootNavigator';
import { installConsoleMirror } from './src/utils/logger';

// Capture console.warn/error into the in-app log buffer (DebugLogModal).
// Runs once at module load, before any component renders.
installConsoleMirror();

export default function App() {
  return (
    <SafeAreaProvider>
      <NavigationContainer>
        <PersonaProvider>
          <DailyContextProvider>
            <DeviceProvider>
              <DebugModeProvider>
                <LocationProvider>
                  <RideProvider>
                    <NotificationDetailProvider>
                      <RootNavigator />
                      <NotificationHistorySheet />
                      <RideDetailModal />
                      <NotificationDeepLinkHandler />
                    </NotificationDetailProvider>
                  </RideProvider>
                </LocationProvider>
              </DebugModeProvider>
            </DeviceProvider>
          </DailyContextProvider>
        </PersonaProvider>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
