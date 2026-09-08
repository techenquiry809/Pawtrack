/**
 * Medication list, reminders, and today's dose log.
 *
 * ── SAFETY, WHICH OUTRANKS EVERYTHING ELSE HERE ───────────────────────
 *
 * This app records; it does not advise. No string in this file — including
 * empty states, validation and the missed-dose flow — may suggest a dose,
 * an amount, or that a dose be doubled, skipped, delayed or caught up. For a
 * missed dose the only acceptable guidance is to follow the veterinarian's
 * instructions. See docs/ARCHITECTURE.md.
 *
 * ── PERMISSION ────────────────────────────────────────────────────────
 *
 * Notification permission is requested at the moment the owner enables their
 * first reminder, never on launch. Declining is fully supported: medications
 * and the dose log keep working, and the card explains how to turn reminders
 * on later in system settings.
 */

import { useCallback, useState } from 'react';
import { Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Button, Card, EmptyState, Heading, Muted,
} from '@/components/ui';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, spacing } from '@/theme/tokens';
import { Icon } from '@/components/Icon';
import * as medicationRepo from '@/db/medicationRepo';
import * as reminders from '@/services/medicationReminders';
import { formatTimeOfDay } from '@/utils/time';
import {
  type MedicationWithReminders,
} from '@/types/domain';


export function MedicationSection({
  dogId,
  dogName,
  reloadToken = 0,
}: {
  dogId: string;
  dogName: string;
  /**
   * Bump to force a reload.
   *
   * The list reloads on focus, which covers arriving at the tab — but not a
   * dose answered by DosePrompt while this section is ALREADY focused and
   * mounted. Without this, the owner answers "Given on time" in the dialog
   * and the row underneath still offers them the three buttons.
   */
  reloadToken?: number;
}) {
  const router = useRouter();
  const [meds, setMeds] = useState<MedicationWithReminders[]>([]);
  const [permission, setPermission] = useState<reminders.PermissionOutcome>('undetermined');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      // Today's doses are no longer read here — they moved to the Check-in
      // screen with the block that displayed them.
      const [m, p] = await Promise.all([
        medicationRepo.listMedications(dogId),
        reminders.getPermissionStatus(),
      ]);
      setMeds(m);
      setPermission(p);
    } catch (e) {
      console.error('[medication] load failed', e);
    } finally {
      setLoaded(true);
    }
  }, [dogId, reloadToken]);

  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void (async () => {
        if (!cancelled) await load();
      })();
      return () => {
        cancelled = true;
      };
    }, [load]),
  );

  /*
   * There is deliberately NO second `useEffect(() => void load(), [load])`.
   *
   * One used to sit here, justified by "useFocusEffect only re-runs its
   * callback on focus — so a token bump while already focused needs its own
   * effect". That is not what useFocusEffect does. Its implementation is
   * `React.useEffect(..., [effect, navigation])` and it calls the effect
   * immediately when `navigation.isFocused()`, so a `reloadToken` bump while
   * focused already re-runs it: the callback identity changes, the effect
   * re-fires, the fetch happens.
   *
   * With both in place the list was fetched twice on mount for no benefit.
   */

  const anyReminderOn = meds.some((m) => m.reminders.some((r) => r.enabled));

  const onToggleReminder = async (
    med: MedicationWithReminders,
    reminderId: string,
    next: boolean,
  ) => {
    const reminder = med.reminders.find((r) => r.id === reminderId);
    if (!reminder) return;

    if (next) {
      // Ask for permission HERE — the first time a reminder is switched on,
      // when the reason is self-evident.
      const outcome = await reminders.requestPermission();
      setPermission(outcome);
      await medicationRepo.setReminderEnabled(reminderId, true);
      if (outcome === 'granted') {
        await reminders.scheduleReminder({
          id: reminderId,
          timeHHMM: reminder.timeHHMM,
          medicationName: med.name,
          dogName,
          dose: med.dose,
          unit: med.unit,
        });
      }
    } else {
      await reminders.cancelReminder(reminder);
      await medicationRepo.setReminderEnabled(reminderId, false);
    }
    await load();
  };


  if (!loaded) {
    return (
      <Card>
        <Muted>Loading…</Muted>
      </Card>
    );
  }

  return (
    <>
      {/* --- Reminders are off, and the owner asked for them ---------- */}
      {permission === 'denied' && anyReminderOn && (
        <Card style={styles.warnCard}>
          <Heading>Reminders are switched off for this app</Heading>
          <Muted style={{ marginTop: 6 }}>
            Your medication list and dose history still work exactly as before —
            only the alerts are silent. To turn them on, open Settings,
            find PawTrack, and allow notifications.
          </Muted>
          <Button
            label="Open Settings"
            variant="ghost"
            onPress={() => void Linking.openSettings()}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      )}

      {meds.length === 0 ? (
        <Card>
          <EmptyState
            icon="medication"
            title="No medications yet"
            body={`Add what ${dogName}'s veterinarian has prescribed, exactly as they wrote it, and set reminder times if you want them.`}
          />
        </Card>
      ) : (
        meds.map((med) => (
          <MedicationCard
            key={med.id}
            med={med}
            onEdit={() => router.push(`/medication-edit?id=${med.id}`)}
            onToggleReminder={(id, next) => void onToggleReminder(med, id, next)}
          />
        ))
      )}

      <Button
        label="Add a medication"
        large
        onPress={() => router.push('/medication-edit')}
        style={{ marginTop: spacing.sm }}
      />

      <Muted style={styles.footNote}>
        PawTrack records what you and your veterinarian decide. It never
        suggests a medication or an amount.
      </Muted>
    </>
  );
}

/* ------------------------------------------------------------------ */

function MedicationCard({
  med,
  onEdit,
  onToggleReminder,
}: {
  med: MedicationWithReminders;
  onEdit: () => void;
  onToggleReminder: (reminderId: string, next: boolean) => void;
}) {
  const amount = [med.dose, med.unit].filter((x) => x.trim()).join('');


  return (
    <Card>
      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Edit ${med.name}`}
        style={({ pressed }) => [styles.medHeader, pressed && styles.pressed]}
      >
        <View style={styles.flexOne}>
          <Heading>{med.name}</Heading>
          <Muted style={{ marginTop: 2 }}>
            {[amount, med.frequency].filter(Boolean).join(' · ') || 'No amount recorded'}
          </Muted>
        </View>
        <Icon name="chevron" size="md" color={colors.inkSoft} />
      </Pressable>

      {/* --- Reminder times ---------------------------------------- */}
      {med.reminders.length > 0 && (
        <View style={styles.remindersBlock}>
          {med.reminders.map((r) => (
            <View key={r.id} style={styles.reminderRow}>
              <Text style={styles.reminderTime}>{formatTimeOfDay(r.timeHHMM)}</Text>
              <View style={styles.flexOne}>
                <Muted>{r.enabled ? 'Reminder on, daily' : 'Reminder off'}</Muted>
              </View>
              <Switch
                value={r.enabled}
                onValueChange={(next) => onToggleReminder(r.id, next)}
                accessibilityLabel={`Daily reminder at ${formatTimeOfDay(r.timeHHMM)}`}
                trackColor={{ true: colors.teal, false: colors.line }}
              />
            </View>
          ))}
        </View>
      )}

      {/*
        Today's doses are NOT here any more.

        They were a TODAY block inside every medication card, so a dog on
        three drugs got three separate lists, none of them in time order, all
        behind the Medication segment. They now live as one chronological list
        on the Check-in screen, which is where the daily ritual happens —
        see components/TodaysDoses.tsx.

        This card keeps what it is for: the prescription as written, and the
        reminders with their toggles.
      */}
    </Card>
  );
}


const styles = StyleSheet.create({
  flexOne: { flex: 1 },
  pressed: { opacity: 0.7 },
  warnCard: { backgroundColor: colors.amberTint },

  medHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },

  remindersBlock: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
  },
  reminderRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  reminderTime: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
    minWidth: 56,
    fontFamily: fontFamily.bold
  },

  dosesBlock: {
    marginTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    paddingTop: spacing.sm,
  },
  dosesLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: colors.inkSoft,
    marginBottom: 6,
    fontFamily: fontFamily.bold
  },
  doseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
  },
  doseSlot: {
    fontSize: fontSize.sm,
    color: colors.inkSoft,
    fontVariant: ['tabular-nums'],
    minWidth: 56,
    fontFamily: fontFamily.regular
  },
  doseButtons: { flexDirection: 'row', gap: 6, flex: 1, justifyContent: 'flex-end' },
  doseBtn: {
    minHeight: 38,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  doseBtnLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.ink, fontFamily: fontFamily.bold },
  doseRecorded: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
  },
  changeBtn: { minHeight: 38, justifyContent: 'center', paddingHorizontal: 8 },
  changeLabel: { color: colors.tealDeep, fontWeight: '700', fontFamily: fontFamily.bold },
  missedNote: { marginTop: spacing.sm },

  footNote: { textAlign: 'center', marginTop: spacing.md },
});
