/**
 * Add or edit one medication, and its reminder times.
 *
 * ── SAFETY ────────────────────────────────────────────────────────────
 *
 * Every field is the owner transcribing what their veterinarian prescribed.
 * There are no suggested amounts, no unit defaults that imply a typical dose,
 * and no placeholder text on the dose field for the same reason the emergency
 * plan has none: a suggestive example reads as a recommendation.
 *
 * Only the name is required — a partially recorded medication is more useful
 * than one the owner abandoned because a field demanded precision they did
 * not have to hand.
 */

import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, Heading, Muted, Title } from '@/components/ui';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, spacing } from '@/theme/tokens';
import { goBackOrHome } from '@/utils/nav';
import { BackButton } from '@/components/BackButton';
import { useActiveDog } from '@/store/appStore';
import * as medicationRepo from '@/db/medicationRepo';
import * as reminders from '@/services/medicationReminders';
import { REMINDER_TIME_RE, type MedicationReminder } from '@/types/domain';
import { TimePickerDialog } from '@/components/TimePickerDialog';
import { formatTimeOfDay } from '@/utils/time';

/** Common dosing clock times. A shortcut for entry, never a recommendation. */
const QUICK_TIMES = ['07:00', '08:00', '12:00', '18:00', '20:00', '22:00'];

export default function MedicationEditScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dog = useActiveDog();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const isEdit = typeof id === 'string' && id.length > 0;

  const [name, setName] = useState('');
  const [dose, setDose] = useState('');
  const [unit, setUnit] = useState('');
  const [frequency, setFrequency] = useState('');
  const [prescriber, setPrescriber] = useState('');
  const [times, setTimes] = useState<MedicationReminder[]>([]);
  /**
   * Which reminder the clock is open for.
   *
   *   null       closed
   *   'new'      adding one
   *   <id>       editing that reminder's time
   *
   * One dialog, two jobs, because they ask the identical question — the only
   * difference is where the answer goes.
   */
  const [picking, setPicking] = useState<null | 'new' | string>(null);
  const [pickError, setPickError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(!isEdit);

  useFocusEffect(
    useCallback(() => {
      if (!isEdit) return;
      let cancelled = false;
      (async () => {
        try {
          const med = await medicationRepo.getMedication(id);
          if (cancelled || !med) return;
          setName(med.name);
          setDose(med.dose);
          setUnit(med.unit);
          setFrequency(med.frequency);
          setPrescriber(med.prescriber);
          setTimes(med.reminders);
        } catch (e) {
          console.error('[medication-edit] load failed', e);
        } finally {
          if (!cancelled) setLoaded(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [id, isEdit]),
  );

  if (!dog) return null;

  const addTime = async (medId: string, timeHHMM: string) => {
    const reminderId = await medicationRepo.addReminder(medId, timeHHMM);
    if (!reminderId) return; // Already present — a duplicate is a mis-tap.

    // Permission is requested HERE, on the first reminder, not at launch.
    const outcome = await reminders.requestPermission();
    if (outcome === 'granted') {
      await reminders.scheduleReminder({
        id: reminderId,
        timeHHMM,
        medicationName: name.trim(),
        dogName: dog.name,
        dose,
        unit,
      });
    }
  };

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter the medication name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const medId = isEdit
        ? id
        : await medicationRepo.createMedication({
            dogId: dog.id, name: trimmed, dose, unit, frequency, prescriber,
          });

      if (isEdit) {
        await medicationRepo.updateMedication(medId, {
          name: trimmed, dose, unit, frequency, prescriber,
        });
      }

      // Persist any times added before the medication existed.
      for (const t of times.filter((t) => t.id.startsWith('pending_'))) {
        await addTime(medId, t.timeHHMM);
      }

      // The notification body carries the name and amount, so an edit to
      // either must be re-scheduled or the alert keeps announcing the old one.
      await reminders.rescheduleAll();
      goBackOrHome(router);
    } catch (e) {
      console.error('[medication-edit] save failed', e);
      setError('Could not save. Please try again.');
      setSaving(false);
    }
  };

  const onAddTime = (timeHHMM: string) => {
    /*
     * The clock cannot produce a malformed time, and the quick chips are
     * constants — so this can only fail if one of those two changes. It is
     * kept as a guard on the write rather than as validation of typing, which
     * is what it used to be: the free-text "Other (HH:MM)" field is gone.
     */
    if (!REMINDER_TIME_RE.test(timeHHMM)) {
      setError('Could not read that time. Please try again.');
      return;
    }
    if (times.some((t) => t.timeHHMM === timeHHMM)) {
      setPickError('There is already a reminder at that time.');
      return;
    }
    setError(null);
    setPickError(null);
    setPicking(null);

    if (!isEdit) {
      // Held locally until the medication row exists to attach them to.
      setTimes((prev) =>
        [...prev, {
          id: `pending_${timeHHMM}`, medicationId: '', timeHHMM, enabled: true,
          notificationId: null, createdAt: Date.now(), updatedAt: Date.now(),
        }].sort((a, b) => a.timeHHMM.localeCompare(b.timeHHMM)),
      );
      return;
    }

    void (async () => {
      await addTime(id, timeHHMM);
      const med = await medicationRepo.getMedication(id);
      if (med) setTimes(med.reminders);
    })();
  };

  /**
   * Move an existing reminder to a new time.
   *
   * A medication that has not been saved yet has no rows to update, so its
   * times are edited in the local list; a saved one goes through the repo and
   * has its notification rebuilt, because the OS is holding a schedule for the
   * old time that nothing else will ever cancel.
   */
  const onEditTime = (reminderId: string, timeHHMM: string) => {
    if (!REMINDER_TIME_RE.test(timeHHMM)) return;
    if (times.some((t) => t.id !== reminderId && t.timeHHMM === timeHHMM)) {
      setPickError('There is already a reminder at that time.');
      return;
    }
    setPickError(null);
    setPicking(null);

    if (reminderId.startsWith('pending_')) {
      setTimes((prev) =>
        prev
          .map((t) => (t.id === reminderId ? { ...t, id: `pending_${timeHHMM}`, timeHHMM } : t))
          .sort((a, b) => a.timeHHMM.localeCompare(b.timeHHMM)),
      );
      return;
    }

    // Narrowed for the closure: `id` is `string | undefined` on the route,
    // and a non-pending reminder can only exist on a saved medication.
    const medId = id;
    if (!medId) return;

    void (async () => {
      const previous = times.find((t) => t.id === reminderId);
      const moved = await medicationRepo.setReminderTime(reminderId, timeHHMM);
      if (!moved) {
        setPickError('There is already a reminder at that time.');
        return;
      }
      // Cancel the alarm for the OLD time before scheduling the new one. The
      // handle is per-device (see setReminderNotificationId), so skipping this
      // leaves a notification firing at a time the app no longer knows about.
      if (previous) await reminders.cancelReminder(previous);

      const med = await medicationRepo.getMedication(medId);
      if (!med) return;
      setTimes(med.reminders);

      const updated = med.reminders.find((r) => r.id === reminderId);
      if (updated?.enabled) {
        await reminders.scheduleReminder({
          id: updated.id,
          timeHHMM: updated.timeHHMM,
          medicationName: name.trim(),
          dogName: dog.name,
          dose,
          unit,
        });
      }
    })();
  };

  const onRemoveTime = (reminder: MedicationReminder) => {
    if (reminder.id.startsWith('pending_')) {
      setTimes((prev) => prev.filter((t) => t.id !== reminder.id));
      return;
    }
    void (async () => {
      await reminders.cancelReminder(reminder);
      await medicationRepo.deleteReminder(reminder.id);
      setTimes((prev) => prev.filter((t) => t.id !== reminder.id));
    })();
  };

  const onDelete = () => {
    if (!isEdit) return;
    Alert.alert(
      `Delete ${name.trim() || 'this medication'}?`,
      'Its reminders and dose history will be removed. This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              for (const r of times) await reminders.cancelReminder(r);
              await medicationRepo.deleteMedication(id);
              goBackOrHome(router);
            })();
          },
        },
      ],
    );
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <BackButton />
      <Title>{isEdit ? 'Edit medication' : 'Add medication'}</Title>
      <Muted style={styles.intro}>
        Enter exactly what {dog.name}&apos;s veterinarian prescribed. Only the
        name is required.
      </Muted>

      <Card style={{ marginTop: spacing.md }}>
        <Field label="MEDICATION NAME" value={name} onChangeText={setName} />
        <View style={styles.pairRow}>
          <View style={styles.flexOne}>
            <Field label="AMOUNT" value={dose} onChangeText={setDose} keyboardType="decimal-pad" />
          </View>
          <View style={styles.unitCol}>
            <Field label="UNIT" value={unit} onChangeText={setUnit} />
          </View>
        </View>
        <Field label="HOW OFTEN" value={frequency} onChangeText={setFrequency} />
        <Field label="PRESCRIBED BY (OPTIONAL)" value={prescriber} onChangeText={setPrescriber} />
      </Card>

      {/* --- Reminder times ----------------------------------------- */}
      <Card>
        <Heading>Reminder times</Heading>
        <Muted style={{ marginTop: 4 }}>
          Add one for each daily dose. You will be asked to allow notifications
          the first time you add one.
        </Muted>

        {times.length > 0 && (
          <View style={styles.timeList}>
            {times.map((t) => (
              <View key={t.id} style={styles.timeRow}>
                {/*
                  The time itself is the edit control. A reminder set to the
                  wrong hour used to be a remove-then-add-again, which loses
                  the row and, on a saved medication, the toggle state with it.
                */}
                <Pressable
                  onPress={() => {
                    setPickError(null);
                    setPicking(t.id);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Change the ${formatTimeOfDay(t.timeHHMM)} reminder`}
                  accessibilityHint="Opens the clock"
                  hitSlop={{ top: 6, bottom: 6 }}
                  style={({ pressed }) => [styles.timeEdit, pressed && styles.pressed]}
                >
                  <Text style={styles.timeValue}>{formatTimeOfDay(t.timeHHMM)}</Text>
                  <Muted style={styles.timeEditHint}>Every day · tap to change</Muted>
                </Pressable>
                <Pressable
                  onPress={() => onRemoveTime(t)}
                  accessibilityRole="button"
                  accessibilityLabel={`Remove the ${formatTimeOfDay(t.timeHHMM)} reminder`}
                  hitSlop={{ top: 4, bottom: 4 }}
                  style={({ pressed }) => [styles.removeBtn, pressed && styles.pressed]}
                >
                  <Text style={styles.removeLabel}>Remove</Text>
                </Pressable>
              </View>
            ))}
          </View>
        )}

        <Muted style={styles.quickLabel}>ADD A TIME</Muted>
        <View style={styles.quickRow}>
          {QUICK_TIMES.filter((q) => !times.some((t) => t.timeHHMM === q)).map((q) => (
            <Pressable
              key={q}
              onPress={() => onAddTime(q)}
              accessibilityRole="button"
              accessibilityLabel={`Add a reminder at ${formatTimeOfDay(q)}`}
              hitSlop={{ top: 4, bottom: 4 }}
              style={({ pressed }) => [styles.quickChip, pressed && styles.pressed]}
            >
              <Text style={styles.quickChipLabel}>{formatTimeOfDay(q)}</Text>
            </Pressable>
          ))}
        </View>

        {/*
          A clock, not a text field. This was "Other (HH:MM)" with a regex
          behind it that rejected `8:00`, `8 pm` and `20.00` — three of the
          four ways people actually write a time — while setting an alarm for
          medication. See components/TimePickerDialog.tsx.
        */}
        <Button
          label="Pick another time"
          variant="ghost"
          onPress={() => {
            setPickError(null);
            setPicking('new');
          }}
        />
      </Card>

      <TimePickerDialog
        visible={picking !== null}
        title={picking === 'new' ? 'Add a reminder time' : 'Change this reminder'}
        // Editing starts from the reminder's own time; adding starts at a
        // plausible morning dose rather than at midnight, which nobody wants
        // and which is the furthest point from every realistic answer.
        value={
          (picking && picking !== 'new'
            ? times.find((t) => t.id === picking)?.timeHHMM
            : null) ?? '08:00'
        }
        error={pickError}
        onCancel={() => {
          setPickError(null);
          setPicking(null);
        }}
        onConfirm={(timeHHMM) => {
          if (picking === 'new') onAddTime(timeHHMM);
          else if (picking) onEditTime(picking, timeHHMM);
        }}
      />

      {error ? <Body style={styles.error}>{error}</Body> : null}

      <Button
        label={isEdit ? 'Save changes' : 'Add medication'}
        large
        loading={saving}
        disabled={!loaded}
        onPress={() => void onSave()}
      />

      {isEdit && (
        <Button
          label="Delete medication"
          variant="ghost"
          onPress={onDelete}
          style={{ marginTop: spacing.sm }}
        />
      )}
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  keyboardType?: 'decimal-pad';
}) {
  return (
    <View>
      <Muted style={styles.fieldLabel}>{label}</Muted>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChangeText}
        keyboardType={keyboardType}
        // No placeholder: an example amount would read as a suggestion.
        accessibilityLabel={label.toLowerCase()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  intro: { marginTop: spacing.sm },
  flexOne: { flex: 1 },
  pressed: { opacity: 0.7 },

  pairRow: { flexDirection: 'row', gap: spacing.md },
  unitCol: { width: 110 },

  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: spacing.md,
    marginBottom: 6,
    fontFamily: fontFamily.bold
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: fontSize.md,
    color: colors.ink,
    backgroundColor: colors.bg,
    fontFamily: fontFamily.regular
  },

  timeList: { marginTop: spacing.md },
  timeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  // The tappable half of the row: the time and what it does, as one target.
  timeEdit: { flex: 1, justifyContent: 'center', paddingVertical: spacing.sm, gap: 1 },
  timeValue: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
    // Tabular figures so a column keeps its digits aligned even though
    // '7:00 am' and '12:30 pm' are different widths.
    fontVariant: ['tabular-nums'],
    fontFamily: fontFamily.bold
  },
  timeEditHint: { fontSize: fontSize.xs },
  // 40pt painted, below MIN_TOUCH_TARGET. The Pressable carries hitSlop to
  // restore a 48pt tap area — growing the box instead would break the row.
  removeBtn: { minHeight: 40, justifyContent: 'center', paddingHorizontal: 6 },
  removeLabel: { color: colors.redDeep, fontWeight: '700', fontSize: fontSize.sm, fontFamily: fontFamily.bold },

  quickLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: spacing.lg,
    marginBottom: 6,
    fontFamily: fontFamily.bold
  },
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  quickChip: {
    minHeight: 40,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  quickChipLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
    fontFamily: fontFamily.bold
  },


  error: { color: colors.redDeep, marginBottom: spacing.sm },
});
