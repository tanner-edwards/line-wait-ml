import * as Notifications from 'expo-notifications';
import { NavigationContainer } from '@react-navigation/native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { useFonts } from 'expo-font';
import { Lora_600SemiBold, Lora_700Bold } from '@expo-google-fonts/lora';
import { Outfit_400Regular, Outfit_500Medium, Outfit_600SemiBold, Outfit_700Bold } from '@expo-google-fonts/outfit';
import { AuthProvider } from './src/context/AuthContext';
import { TripProvider } from './src/context/TripContext';
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
import { FirstLaunchNotifPrompt } from './src/components/FirstLaunchNotifPrompt';
import { LocationNotificationPrompt } from './src/components/LocationNotificationPrompt';
import { RootNavigator } from './src/navigation/RootNavigator';
import { installConsoleMirror } from './src/utils/logger';

// Capture console.warn/error into the in-app log buffer (DebugLogModal).
// Runs once at module load, before any component renders.
installConsoleMirror();

// Show local notifications (e.g., ride reminders) even when the app is foregrounded.
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

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
        <AuthProvider>
          <TripProvider>
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
                          <FirstLaunchNotifPrompt />
                          <LocationNotificationPrompt />
                        </NotificationDetailProvider>
                      </RideProvider>
                    </LocationProvider>
                  </DebugModeProvider>
                </DeviceProvider>
              </DailyContextProvider>
            </PersonaProvider>
          </TripProvider>
        </AuthProvider>
      </NavigationContainer>
    </SafeAreaProvider>
  );
}
