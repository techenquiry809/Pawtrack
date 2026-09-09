/**
 * Declares the exact-alarm permissions, so a dose reminder fires ON TIME.
 *
 * ── THE BUG THIS FIXES ────────────────────────────────────────────────
 *
 * A reminder set for 5:30 arrived at 5:32, and only once the app was opened.
 * The scheduling code was never the problem — services/medicationReminders.ts
 * uses a real `Notifications.scheduleNotificationAsync` with a DAILY trigger
 * and a HIGH-importance channel, which is a genuine OS alarm, not a JS timer.
 *
 * The problem is one branch inside expo-notifications:
 *
 *     // ExpoSchedulingDelegate.kt
 *     if (SDK_INT < S || alarmManager.canScheduleExactAlarms()) {
 *       AlarmManagerCompat.setExactAndAllowWhileIdle(...)   // to the second
 *     } else {
 *       AlarmManagerCompat.setAndAllowWhileIdle(...)        // "sometime soon"
 *     }
 *
 * `canScheduleExactAlarms()` is false on Android 12+ unless one of the two
 * permissions below is held, and nothing declared either. So every reminder
 * this app has ever set took the second branch: `setAndAllowWhileIdle` is
 * explicitly inexact, and the OS batches it into the next Doze maintenance
 * window. Minutes late is the DOCUMENTED behaviour of that call, not a
 * malfunction — and picking the phone up is one of the things that ends Doze,
 * which is why opening the app appeared to "deliver" the notification.
 *
 * ── WHY TWO PERMISSIONS AND NOT ONE ───────────────────────────────────
 *
 *   SCHEDULE_EXACT_ALARM  API 31-32. Granted at install on those two levels,
 *                         so it needs no prompt there. Capped at 32 because
 *                         from API 33 it becomes deny-by-default and pulls in
 *                         a Play Console declaration for a permission that
 *                         USE_EXACT_ALARM already covers.
 *   USE_EXACT_ALARM       API 33+. Granted at install, no prompt, no runtime
 *                         request. This is the one that does the work on any
 *                         current phone.
 *
 * That pairing is Google's own recommendation for an app whose alarms the USER
 * set and expects at a stated time.
 *
 * ── THE PLAY POLICY POINT, STATED PLAINLY ─────────────────────────────
 *
 * USE_EXACT_ALARM is restricted. It is for apps whose core function needs
 * user-set exact-time notifications — alarm clocks, calendars, and reminders
 * of this kind. A medication reminder for a dog with a seizure disorder is a
 * defensible fit, but it IS a declaration you have to be prepared to make and
 * stand behind at review. If that is not wanted, the alternative is not
 * "declare nothing" — it is to tell owners plainly that reminders may arrive a
 * few minutes late, because that is what the inexact branch guarantees.
 *
 * ── WHY A MOD RATHER THAN app.config.ts ───────────────────────────────
 *
 * `android.permissions` is a list of plain strings with nowhere to put
 * `android:maxSdkVersion`. Same reason withCappedLegacyStorage exists; this
 * follows that file's shape deliberately.
 */

const { withAndroidManifest } = require('expo/config-plugins');

/**
 * The permissions to declare, and the cap each one needs.
 * `null` means "no cap" — the permission applies at every level from its own
 * minimum upwards.
 */
const EXACT_ALARM_PERMISSIONS = {
  // Deny-by-default from API 33, where USE_EXACT_ALARM takes over.
  'android.permission.SCHEDULE_EXACT_ALARM': '32',
  'android.permission.USE_EXACT_ALARM': null,
};

/** Exported for the unit check; keep it pure. */
function addExactAlarmPermissions(androidManifest) {
  const manifest = androidManifest.manifest;
  if (!Array.isArray(manifest['uses-permission'])) {
    manifest['uses-permission'] = [];
  }
  const permissions = manifest['uses-permission'];

  for (const [name, cap] of Object.entries(EXACT_ALARM_PERMISSIONS)) {
    const existing = permissions.find((p) => p.$?.['android:name'] === name);

    if (existing) {
      // Only ever ADD the cap, never overwrite one already present — the same
      // rule withCappedLegacyStorage follows, and for the same reason: an
      // attribute someone else set is a decision, not noise.
      if (cap !== null && existing.$['android:maxSdkVersion'] === undefined) {
        existing.$['android:maxSdkVersion'] = cap;
      }
      continue;
    }

    const entry = { $: { 'android:name': name } };
    if (cap !== null) entry.$['android:maxSdkVersion'] = cap;
    permissions.push(entry);
  }

  return androidManifest;
}

const withExactAlarms = (config) =>
  withAndroidManifest(config, (cfg) => {
    cfg.modResults = addExactAlarmPermissions(cfg.modResults);
    return cfg;
  });

module.exports = withExactAlarms;
module.exports.addExactAlarmPermissions = addExactAlarmPermissions;
module.exports.EXACT_ALARM_PERMISSIONS = EXACT_ALARM_PERMISSIONS;
