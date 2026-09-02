/**
 * Medication reminders — scheduling, permission, and timezone repair.
 *
 * ── WHY A CALENDAR TRIGGER, NOT AN INTERVAL ───────────────────────────
 *
 * `DailyTriggerInput` fires at a local wall-clock time. A `timeInterval`
 * trigger fires every 86,400 seconds from whenever it was set, which drifts
 * off the hour and, worse, keeps firing at the OLD local time after the owner
 * flies somewhere. An owner who travels with an epileptic dog still needs the
 * 8am dose reminder at 8am.
 *
 * ── PERMISSION IS REQUESTED ON FIRST REMINDER, NOT AT LAUNCH ──────────
 *
 * A permission prompt on first open, before the owner has seen what the app
 * does, is the reliable way to get a permanent "no". We ask at the exact
 * moment they set a reminder, when the reason is self-evident. Declining is a
 * supported state: everything else in the app keeps working, and the
 * medication list simply says reminders are off and how to turn them on.
 *
 * ── WHAT A NOTIFICATION MAY SAY ───────────────────────────────────────
 *
 * Lock-screen notifications are readable by anyone holding the phone. The body
 * carries the medication name, the dog's name and the prescribed amount, and
 * nothing else. No diagnosis, no condition, no instruction — see the safety
 * rules in docs/ARCHITECTURE.md. It also never tells the owner what to DO
 * about a dose; it states that one is scheduled.
 */

import * as Notifications from 'expo-notifications';
import { Platform } from 'react-native';
import * as medicationRepo from '@/db/medicationRepo';

const ANDROID_CHANNEL = 'medication-reminders';

export type PermissionOutcome = 'granted' | 'denied' | 'undetermined';

/** Foreground presentation. Without this a reminder is silent while the app is open. */
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowBanner: true,
    shouldShowList: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

async function ensureAndroidChannel(): Promise<void> {
  if (Platform.OS !== 'android') return;
  await Notifications.setNotificationChannelAsync(ANDROID_CHANNEL, {
    name: 'Medication reminders',
    importance: Notifications.AndroidImportance.HIGH,
    // No description mentioning seizures — channel names are visible in
    // system settings, which other people can also read.
    vibrationPattern: [0, 250, 250, 250],
  });
}

/** Current status WITHOUT prompting. Safe to call on any screen. */
export async function getPermissionStatus(): Promise<PermissionOutcome> {
  const { status } = await Notifications.getPermissionsAsync();
  if (status === 'granted') return 'granted';
  if (status === 'denied') return 'denied';
  return 'undetermined';
}

/**
 * Prompts, but only when we have not asked before. Call this at the moment the
 * owner enables their first reminder — never on launch.
 */
export async function requestPermission(): Promise<PermissionOutcome> {
  const existing = await Notifications.getPermissionsAsync();
  if (existing.status === 'granted') {
    await ensureAndroidChannel();
    return 'granted';
  }
  // iOS will not show a second system prompt once denied; asking again is a
  // no-op that returns the same answer, which the caller turns into
  // instructions for Settings rather than a retry loop.
  const { status } = await Notifications.requestPermissionsAsync();
  if (status === 'granted') {
    await ensureAndroidChannel();
    return 'granted';
  }
  return status === 'denied' ? 'denied' : 'undetermined';
}

/** "Phenobarbital for River — scheduled dose: 60mg" */
export function reminderBody(
  medicationName: string,
  dogName: string,
  dose: string,
  unit: string,
): string {
  const amount = [dose.trim(), unit.trim()].filter(Boolean).join('');
  const base = `${medicationName} for ${dogName}`;
  return amount ? `${base} — scheduled dose: ${amount}` : base;
}

function parseHHMM(timeHHMM: string): { hour: number; minute: number } | null {
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(timeHHMM);
  if (!match) return null;
  return { hour: Number(match[1]), minute: Number(match[2]) };
}

/**
 * Schedules one repeating daily reminder and stores its handle.
 * Returns null when permission is missing — the row stays enabled so the
 * reminder starts working if permission is granted later.
 */
export async function scheduleReminder(reminder: {
  id: string;
  timeHHMM: string;
  medicationName: string;
  dogName: string;
  dose: string;
  unit: string;
}): Promise<string | null> {
  if ((await getPermissionStatus()) !== 'granted') return null;

  const at = parseHHMM(reminder.timeHHMM);
  if (!at) {
    console.warn('[reminders] bad time, not scheduling', reminder.timeHHMM);
    return null;
  }

  await ensureAndroidChannel();

  const notificationId = await Notifications.scheduleNotificationAsync({
    content: {
      title: 'Medication reminder',
      body: reminderBody(
        reminder.medicationName, reminder.dogName, reminder.dose, reminder.unit,
      ),
      // Lets a tap open straight to the medication section.
      data: { kind: 'medication-reminder', reminderId: reminder.id },
      ...(Platform.OS === 'android' ? { channelId: ANDROID_CHANNEL } : {}),
    },
    trigger: {
      type: Notifications.SchedulableTriggerInputTypes.DAILY,
      hour: at.hour,
      minute: at.minute,
    },
  });

  await medicationRepo.setReminderNotificationId(reminder.id, notificationId);
  return notificationId;
}

export async function cancelReminder(reminder: {
  id: string;
  notificationId: string | null;
}): Promise<void> {
  if (reminder.notificationId) {
    try {
      await Notifications.cancelScheduledNotificationAsync(reminder.notificationId);
    } catch (e) {
      // An already-cancelled handle throws on some platforms. Harmless.
      console.warn('[reminders] cancel failed', e);
    }
  }
  await medicationRepo.setReminderNotificationId(reminder.id, null);
}

/**
 * Rebuilds every scheduled notification from the database.
 *
 * Call after a timezone change, and after any change to a medication's name or
 * dose — the body text is baked into the scheduled notification, so an edit
 * that is not rescheduled would keep announcing the old amount.
 */
export async function rescheduleAll(): Promise<void> {
  if ((await getPermissionStatus()) !== 'granted') return;

  // Cancel everything rather than diffing. The set is small (a handful of
  // reminders), and a diff that gets it wrong leaves an orphaned notification
  // firing forever with no row to cancel it.
  await Notifications.cancelAllScheduledNotificationsAsync();

  const reminders = await medicationRepo.listEnabledReminders();
  for (const r of reminders) {
    await scheduleReminder({
      id: r.id,
      timeHHMM: r.timeHHMM,
      medicationName: r.medicationName,
      dogName: r.dogName,
      dose: r.dose,
      unit: r.unit,
    });
  }
}

/**
 * Reschedules only if the device's UTC offset has moved since we last looked.
 *
 * Wire this to an AppState 'active' listener. Comparing the offset rather than
 * rescheduling unconditionally avoids churning the notification queue on every
 * single foreground.
 */
let lastOffsetMin: number | null = null;

export async function rescheduleIfTimezoneChanged(): Promise<boolean> {
  const current = -new Date().getTimezoneOffset();
  if (lastOffsetMin === null) {
    lastOffsetMin = current;
    return false;
  }
  if (lastOffsetMin === current) return false;

  lastOffsetMin = current;
  await rescheduleAll();
  return true;
}
