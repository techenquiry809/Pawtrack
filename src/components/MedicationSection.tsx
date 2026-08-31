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
import { Alert, Linking, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import {
  Body, Button, Card, EmptyState, Heading, Muted, Pill, type PillTone,
} from '@/components/ui';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, spacing } from '@/theme/tokens';
import { Icon } from '@/components/Icon';
import * as medicationRepo from '@/db/medicationRepo';
import * as reminders from '@/services/medicationReminders';
import { localDayKey } from '@/utils/time';
import {
  DOSE_STATUS_LABEL,
  type DoseStatus,
  type MedicationDose,
  type MedicationWithReminders,
} from '@/types/domain';

const DOSE_TONE: Record<DoseStatus, PillTone> = {
  given: 'green',
  late: 'amber',
  missed: 'red',
};

export function MedicationSection({ dogId, dogName }: { dogId: string; dogName: string }) {
  const router = useRouter();
  const [meds, setMeds] = useState<MedicationWithReminders[]>([]);
  const [doses, setDoses] = useState<MedicationDose[]>([]);
  const [permission, setPermission] = useState<reminders.PermissionOutcome>('undetermined');
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [m, d, p] = await Promise.all([
        medicationRepo.listMedications(dogId),
        medicationRepo.listDosesForDate(dogId, localDayKey()),
        reminders.getPermissionStatus(),
      ]);
      setMeds(m);
      setDoses(d);
      setPermission(p);
    } catch (e) {
      console.error('[medication] load failed', e);
    } finally {
      setLoaded(true);
    }
  }, [dogId]);

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

  const onRecordDose = async (
    med: MedicationWithReminders,
    status: DoseStatus,
    scheduledHHMM: string,
  ) => {
    try {
      await medicationRepo.recordDose({
        medicationId: med.id,
        dogId,
        status,
        scheduledHHMM,
      });
      await load();
    } catch (e) {
      console.error('[medication] record dose failed', e);
    }
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
            find Paws Journal, and allow notifications.
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
            doses={doses.filter((d) => d.medicationId === med.id)}
            onEdit={() => router.push(`/medication-edit?id=${med.id}`)}
            onToggleReminder={(id, next) => void onToggleReminder(med, id, next)}
            onRecordDose={(status, slot) => void onRecordDose(med, status, slot)}
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
        Paws Journal records what you and your veterinarian decide. It never
        suggests a medication or an amount.
      </Muted>
    </>
  );
}

/* ------------------------------------------------------------------ */

function MedicationCard({
  med,
  doses,
  onEdit,
  onToggleReminder,
  onRecordDose,
}: {
  med: MedicationWithReminders;
  doses: MedicationDose[];
  onEdit: () => void;
  onToggleReminder: (reminderId: string, next: boolean) => void;
  onRecordDose: (status: DoseStatus, scheduledHHMM: string) => void;
}) {
  const amount = [med.dose, med.unit].filter((x) => x.trim()).join('');

  // A dose slot per reminder time, plus one unscheduled slot when there are no
  // reminders at all — an owner who does not want alerts still logs doses.
  const slots = med.reminders.length > 0
    ? med.reminders.map((r) => r.timeHHMM)
    : [''];

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
              <Text style={styles.reminderTime}>{r.timeHHMM}</Text>
              <View style={styles.flexOne}>
                <Muted>{r.enabled ? 'Reminder on, daily' : 'Reminder off'}</Muted>
              </View>
              <Switch
                value={r.enabled}
                onValueChange={(next) => onToggleReminder(r.id, next)}
                accessibilityLabel={`Daily reminder at ${r.timeHHMM}`}
                trackColor={{ true: colors.teal, false: colors.line }}
              />
            </View>
          ))}
        </View>
      )}

      {/* --- Today's doses ------------------------------------------ */}
      <View style={styles.dosesBlock}>
        <Text style={styles.dosesLabel}>TODAY</Text>
        {slots.map((slot) => {
          const recorded = doses.find((d) => d.scheduledHHMM === slot);
          return (
            <View key={slot || 'unscheduled'} style={styles.doseRow}>
              <Text style={styles.doseSlot}>{slot || 'Dose'}</Text>
              {recorded ? (
                <View style={styles.doseRecorded}>
                  <Pill label={DOSE_STATUS_LABEL[recorded.status]} tone={DOSE_TONE[recorded.status]} />
                  <Pressable
                    onPress={() =>
                      Alert.alert(
                        'Change this record?',
                        'Pick what actually happened.',
                        [
                          { text: 'Cancel', style: 'cancel' },
                          { text: 'Given on time', onPress: () => onRecordDose('given', slot) },
                          { text: 'Given late', onPress: () => onRecordDose('late', slot) },
                          { text: 'Not given', onPress: () => onRecordDose('missed', slot) },
                        ],
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Change the record for ${slot || 'this dose'}`}
                    style={({ pressed }) => [styles.changeBtn, pressed && styles.pressed]}
                  >
                    <Muted style={styles.changeLabel}>Change</Muted>
                  </Pressable>
                </View>
              ) : (
                <View style={styles.doseButtons}>
                  <DoseButton label="Given" onPress={() => onRecordDose('given', slot)} />
                  <DoseButton label="Late" onPress={() => onRecordDose('late', slot)} />
                  <DoseButton label="Missed" onPress={() => onRecordDose('missed', slot)} />
                </View>
              )}
            </View>
          );
        })}
        {doses.some((d) => d.status === 'missed') && (
          <Muted style={styles.missedNote}>
            {/* The ONLY acceptable guidance for a missed dose. */}
            Follow your veterinarian&apos;s instructions about a missed dose.
          </Muted>
        )}
      </View>
    </Card>
  );
}

function DoseButton({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Record dose as ${label}`}
      style={({ pressed }) => [styles.doseBtn, pressed && styles.pressed]}
    >
      <Text style={styles.doseBtnLabel}>{label}</Text>
    </Pressable>
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
