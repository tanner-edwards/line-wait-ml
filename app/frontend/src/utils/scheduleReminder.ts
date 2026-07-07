import { Platform } from 'react-native';
import * as Notifications from 'expo-notifications';

export type ReminderResult = 'scheduled' | 'past' | 'denied' | 'unsupported';

function getLAMinutesNow(): number {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Los_Angeles',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(new Date());
  return (
    Number(parts.find(p => p.type === 'hour')?.value ?? 0) * 60 +
    Number(parts.find(p => p.type === 'minute')?.value ?? 0)
  );
}

// Schedule a local notification for a ride at a specific LA-local time.
// reminderAtMinutes is minutes-from-midnight in LA time (e.g., 795 = 1:15 PM).
// Returns 'scheduled' on success, otherwise explains why it didn't fire.
export async function scheduleRideReminder(
  rideName: string,
  reminderAtMinutes: number,
): Promise<ReminderResult> {
  if (Platform.OS === 'web') return 'unsupported';

  const secondsUntil = Math.round((reminderAtMinutes - getLAMinutesNow()) * 60);
  if (secondsUntil <= 0) return 'past';

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return 'denied';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: rideName,
      body: 'A short wait window is coming up — good time to head over.',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: secondsUntil,
    },
  });

  return 'scheduled';
}

// Schedule a one-off local notification for when a closed ride is predicted
// to reopen. predictedReopenAt is an ISO timestamp; the notification fires
// at that moment. Returns the same result shape as scheduleRideReminder.
export async function scheduleReopenReminder(
  rideName: string,
  predictedReopenAt: string,
): Promise<ReminderResult> {
  if (Platform.OS === 'web') return 'unsupported';

  const secondsUntil = Math.round((new Date(predictedReopenAt).getTime() - Date.now()) / 1000);
  if (secondsUntil <= 0) return 'past';

  const { status } = await Notifications.requestPermissionsAsync();
  if (status !== 'granted') return 'denied';

  await Notifications.scheduleNotificationAsync({
    content: {
      title: rideName,
      body: 'Should be back around now — head over for a shorter line.',
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.TIME_INTERVAL,
      seconds: secondsUntil,
    },
  });

  return 'scheduled';
}
