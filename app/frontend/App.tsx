import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Lora_600SemiBold, Lora_700Bold } from '@expo-google-fonts/lora';
import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold } from '@expo-google-fonts/outfit';
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
import { LocationNotificationPrompt } from './src/components/LocationNotificationPrompt';
import { RootNavigator } from './src/navigation/RootNavigator';
import { installConsoleMirror } from './src/utils/logger';

// Capture console.warn/error into the in-app log buffer (DebugLogModal).
// Runs once at module load, before any component renders.
installConsoleMirror();

export default function App() {
  const [fontsLoaded] = useFonts({
    Lora_600SemiBold,
    Lora_700Bold,
    Outfit_400Regular,
    Outfit_500Medium,
    Outfit_600SemiBold,
    Outfit_700Bold,
  });

  // Hold render until fonts are ready — prevents a flash of system font
  // before Lora/Outfit load, which causes layout shifts on first paint.
  if (!fontsLoaded) return null;

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
                      <LocationNotificationPrompt />
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
