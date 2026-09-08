/**
 * Every dose due today, in clock order, on the Check-in screen.
 *
 * ── WHY IT MOVED OFF THE MEDICATION TAB ───────────────────────────────
 *
 * It used to be a "TODAY" block repeated inside each medication card, behind
 * the Medication segment. That put the one thing an owner does daily two taps
 * from where they do it, and split it: a dog on three drugs got three
 * separate TODAY lists, each in its own card, none of them in time order. The
 * question is never "what is outstanding for Keppra" — it is "what does my
 * dog still need today", which is one list.
 *
 * So it is one list, sorted by time, on the screen the daily ritual already
 * lives on. The Medication tab keeps what it is for: the prescription, the
 * reminders and their toggles.
 *
 * ── IT KNOWS WHAT TIME IT IS ──────────────────────────────────────────
 *
 * A slot whose time has not arrived is not a question yet. Those are shown,
 * because "what is still coming today" is half of what this list is for, but
 * they are quiet and carry the time rather than three buttons demanding an
 * answer nobody can give. A slot that is past and unanswered is marked, so
 * the eye lands on the row that actually needs something.
 *
 * The clock is read on every render and on focus, not sampled once — this
 * screen is left open, and a list that still says "later" at 9pm about a 6pm
 * dose is worse than no list.
 */

import { useCallback, useState } from 'react';
import { Alert, Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Card, Muted, Pill, type PillTone } from '@/components/ui';
import * as medicationRepo from '@/db/medicationRepo';
import {
  DOSE_STATUS_LABEL,
  type DoseStatus,
  type MedicationDose,
} from '@/types/domain';
import { formatTimeOfDay, localDayKey } from '@/utils/time';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';

const DOSE_TONE: Record<DoseStatus, PillTone> = {
  given: 'green',
  late: 'amber',
  missed: 'red',
};

/**
 * Minutes past a slot before it counts as needing an answer.
 *
 * The same grace the dose prompt uses, and for the same reason: the reminder
 * fires ON the slot, and giving a dog a tablet takes a few minutes. Marking a
 * dose overdue while the owner is in the middle of giving it is the app
 * arguing with the person using it.
 */
const DUE_GRACE_MIN = 20;

type Slot = {
  key: string;
  medicationId: string;
  medicationName: string;
  /** '' for a medication with no reminder times — an unscheduled dose. */
  timeHHMM: string;
  recorded: MedicationDose | undefined;
  /** False while the slot's time is still ahead of the clock. */
  due: boolean;
};

/** What the card is titled with: the drug itself, not just "medication". */
type Named = { name: string; amount: string };

/** Local wall-clock 'HH:MM', for comparing against a stored slot. */
function nowHHMM(offsetMinutes = 0): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** The prescribed amount, exactly as the owner typed it: '60mg', '1 tablet'. */
function amountOf(med: { dose: string; unit: string }): string {
  return [med.dose, med.unit].filter((x) => x.trim()).join('');
}

export function TodaysDoses({ dogId }: { dogId: string }) {
  const [slots, setSlots] = useState<Slot[]>([]);
  const [meds, setMeds] = useState<Named[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [medications, doses] = await Promise.all([
        medicationRepo.listMedications(dogId),
        medicationRepo.listDosesForDate(dogId, localDayKey()),
      ]);

      const cutoff = nowHHMM(-DUE_GRACE_MIN);
      const next: Slot[] = [];

      for (const med of medications) {
        // A medication with no reminder times still gets one unscheduled row:
        // an owner who does not want alarms still has doses to log.
        const times = med.reminders.length > 0
          ? med.reminders.map((r) => r.timeHHMM)
          : [''];

        for (const timeHHMM of times) {
          next.push({
            key: `${med.id}@${timeHHMM}`,
            medicationId: med.id,
            medicationName: med.name,
            timeHHMM,
            recorded: doses.find(
              (d) => d.medicationId === med.id && d.scheduledHHMM === timeHHMM,
            ),
            // An unscheduled dose has no time to be early for.
            due: timeHHMM === '' || timeHHMM <= cutoff,
          });
        }
      }

      // Clock order, unscheduled last — it belongs to no particular hour and
      // would otherwise sort to the top of the day on an empty string.
      next.sort((a, b) => {
        if (a.timeHHMM === '') return 1;
        if (b.timeHHMM === '') return -1;
        return a.timeHHMM.localeCompare(b.timeHHMM);
      });

      setSlots(next);
      setMeds(medications.map((m) => ({ name: m.name, amount: amountOf(m) })));
    } catch (e) {
      console.error('[doses] load failed', e);
    } finally {
      setLoaded(true);
    }
  }, [dogId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const record = async (slot: Slot, status: DoseStatus) => {
    try {
      await medicationRepo.recordDose({
        medicationId: slot.medicationId,
        dogId,
        status,
        scheduledHHMM: slot.timeHHMM,
      });
      await load();
    } catch (e) {
      console.error('[doses] record failed', e);
    }
  };

  // Nothing prescribed: the Medication tab already says so and offers to add
  // one. A second empty state on the daily screen is noise.
  if (!loaded || slots.length === 0) return null;

  return (
    <Card style={styles.card}>
      {/*
        The drug is named at the top, not left implied by the card's title. An
        owner glancing at "8:00 am — Given" has to already know what was given;
        naming it turns the card into a record they can read back. With one
        medication the prescribed amount rides alongside, so the whole
        prescription is on the row people actually look at.
      */}
      <View style={styles.header}>
        <Text style={styles.label}>TODAY&rsquo;S MEDICATION</Text>
        <View style={styles.titleRow}>
          <Text style={styles.medTitle} numberOfLines={2}>
            {meds.map((m) => m.name).join('  ·  ')}
          </Text>
          {meds.length === 1 && meds[0]?.amount ? (
            <Muted style={styles.medAmount}>{meds[0].amount}</Muted>
          ) : null}
        </View>
      </View>

      {slots.map((slot) => (
        <View key={slot.key} style={styles.row}>
          <View style={styles.when}>
            <Text style={[styles.time, !slot.due && !slot.recorded && styles.timeLater]}>
              {slot.timeHHMM ? formatTimeOfDay(slot.timeHHMM) : 'Dose'}
            </Text>
            {/* The drug's name only when there is more than one to tell
                apart. On a single-medication dog it is the same word on
                every row, which is noise rather than information. */}
            {meds.length > 1 ? (
              <Muted numberOfLines={1} style={styles.medName}>
                {slot.medicationName}
              </Muted>
            ) : null}
          </View>

          {slot.recorded ? (
            <View style={styles.recorded}>
              <Pill
                label={DOSE_STATUS_LABEL[slot.recorded.status]}
                tone={DOSE_TONE[slot.recorded.status]}
              />
              <Pressable
                onPress={() =>
                  Alert.alert('Change this record?', 'Pick what actually happened.', [
                    { text: 'Cancel', style: 'cancel' },
                    { text: 'Given on time', onPress: () => void record(slot, 'given') },
                    { text: 'Given late', onPress: () => void record(slot, 'late') },
                    { text: 'Not given', onPress: () => void record(slot, 'missed') },
                  ])
                }
                accessibilityRole="button"
                accessibilityLabel={`Change the record for ${slot.medicationName} at ${slot.timeHHMM ? formatTimeOfDay(slot.timeHHMM) : 'this dose'}`}
                hitSlop={8}
                style={({ pressed }) => pressed && styles.pressed}
              >
                <Text style={styles.change}>Change</Text>
              </Pressable>
            </View>
          ) : slot.due ? (
            <View style={styles.buttons}>
              <DoseButton label="Given" onPress={() => void record(slot, 'given')} />
              <DoseButton label="Late" onPress={() => void record(slot, 'late')} />
              <DoseButton label="Missed" onPress={() => void record(slot, 'missed')} />
            </View>
          ) : (
            /*
              Still ahead of the clock. Deliberately not three buttons: there
              is nothing to report about a dose that has not happened, and the
              app never records a status the owner did not give it.
            */
            <Muted style={styles.later}>Later today</Muted>
          )}
        </View>
      ))}

      {slots.some((s) => s.recorded?.status === 'missed') ? (
        <Muted style={styles.missedNote}>
          {/* The ONLY acceptable guidance for a missed dose. */}
          Follow your veterinarian&apos;s instructions about a missed dose.
        </Muted>
      ) : null}
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
  card: { marginTop: spacing.lg, gap: 2 },
  header: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.line,
    paddingBottom: spacing.sm,
    marginBottom: spacing.xs,
  },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: colors.inkSoft,
    fontFamily: fontFamily.bold,
  },
  titleRow: {
    flexDirection: 'row',
    alignItems: 'baseline',
    flexWrap: 'wrap',
    gap: spacing.xs,
    marginTop: 3,
  },
  medTitle: {
    flexShrink: 1,
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
    fontFamily: fontFamily.bold,
  },
  medAmount: { fontSize: fontSize.sm },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: 46,
  },
  when: { flex: 1 },
  time: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
    // Tabular figures so a column of times keeps its digits aligned.
    fontVariant: ['tabular-nums'],
    fontFamily: fontFamily.bold,
  },
  /** Quieter for a slot that has not come round yet. */
  timeLater: { color: colors.inkSoft, fontWeight: '600', fontFamily: fontFamily.semibold },
  medName: { fontSize: fontSize.xs },

  recorded: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  change: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.tealDeep,
    fontFamily: fontFamily.bold,
  },

  buttons: { flexDirection: 'row', gap: 6 },
  doseBtn: {
    minHeight: 34,
    paddingHorizontal: 12,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  doseBtnLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
    fontFamily: fontFamily.bold,
  },
  later: { fontSize: fontSize.sm },

  missedNote: { marginTop: spacing.sm, lineHeight: 19 },
  pressed: { opacity: 0.6 },
});
