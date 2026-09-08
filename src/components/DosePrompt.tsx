/**
 * "Did the dose actually happen?" — asked once, on the check-in tab.
 *
 * ── WHY IT EXISTS ─────────────────────────────────────────────────────
 *
 * The dose log is the control dataset the seizure analysis leans on: whether
 * a drug was taken, and when, is one of the few things that can explain a
 * cluster. But logging a dose lived two taps inside the Medication section,
 * behind a segmented control, on a tab most owners open for the mood row. The
 * result was reminders firing daily and a dose log with holes in it — and a
 * hole is not "not given", it is nothing at all.
 *
 * So the app asks, once, for each dose that has come and gone unanswered.
 *
 * ── WHAT IT WILL NOT DO ───────────────────────────────────────────────
 *
 * It never assumes. There is no "mark as given" default and no inference from
 * silence — see DOSE_STATUSES in types/domain.ts, which says the same thing:
 * "you did not open the app" is not evidence a dose was missed. Every answer
 * here is the owner's own report, including the option to say nothing yet.
 *
 * It also never asks about a dose that has not happened. A slot is only in the
 * queue once its time is properly past — see DUE_GRACE_MIN — because the one
 * thing worse than an unanswered dose is a wrong answer recorded about a dose
 * the owner was in the middle of giving.
 *
 * And it only asks about reminders that are switched ON. Turning a reminder
 * off is how an owner says they do not want this medication chasing them;
 * honouring that for the notification and then chasing them in-app anyway
 * would make the toggle a lie.
 *
 * ── DISMISSAL IS PER SESSION, NOT PER DAY ─────────────────────────────
 *
 * "Not now" hides the whole queue until the app is next launched. Not
 * permanently — the dose is still unanswered and the Medication section still
 * shows it waiting — and not for five minutes either, which would be nagging
 * with extra steps.
 */

import { useCallback, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Body, Heading, Muted } from '@/components/ui';
import { Dialog } from '@/components/Dialog';
import * as medicationRepo from '@/db/medicationRepo';
import { DOSE_STATUS_LABEL, type DoseStatus } from '@/types/domain';
import { formatTimeOfDay, localDayKey } from '@/utils/time';
import {
  colors,
  fontFamily,
  fontSize,
  MIN_TOUCH_TARGET,
  radius,
  spacing,
} from '@/theme/tokens';

/**
 * How long after a dose time to wait before asking about it.
 *
 * The reminder notification fires AT the slot time, and giving a dog a tablet
 * takes a few minutes — so prompting on the dot would interrupt the very task
 * the reminder just started. Twenty minutes is long enough to be out of the
 * way and short enough that a morning dose is still answerable over breakfast.
 */
const DUE_GRACE_MIN = 20;

/** Answers, in the order they are offered. Widest-to-narrowest likelihood. */
const ANSWERS: {
  status: DoseStatus;
  fill: 'good' | 'warn' | 'bad';
  ink: 'goodLabel' | 'warnLabel' | 'badLabel';
}[] = [
  { status: 'given', fill: 'good', ink: 'goodLabel' },
  { status: 'late', fill: 'warn', ink: 'warnLabel' },
  { status: 'missed', fill: 'bad', ink: 'badLabel' },
];

type DueDose = {
  medicationId: string;
  medicationName: string;
  amount: string;
  scheduledHHMM: string;
};

/** Local wall-clock 'HH:MM', for comparing against a stored slot. */
function nowHHMM(offsetMinutes = 0): string {
  const d = new Date(Date.now() + offsetMinutes * 60_000);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

export function DosePrompt({
  dogId,
  dogName,
  onRecorded,
}: {
  dogId: string;
  dogName: string;
  /** Lets the medication list below refresh with the answer just given. */
  onRecorded?: () => void;
}) {
  const [queue, setQueue] = useState<DueDose[]>([]);
  const [busy, setBusy] = useState(false);
  /**
   * Set by "Not now", and never cleared.
   *
   * A ref rather than state because nothing renders from it — and because it
   * must survive the reload that runs on every focus, which is exactly what
   * would otherwise bring the dialog straight back.
   */
  const dismissed = useRef(false);

  const load = useCallback(async () => {
    if (dismissed.current) return;
    try {
      const [meds, doses] = await Promise.all([
        medicationRepo.listMedications(dogId),
        medicationRepo.listDosesForDate(dogId, localDayKey()),
      ]);

      // Everything already answered today, as 'medicationId@HH:MM'.
      const answered = new Set(doses.map((d) => `${d.medicationId}@${d.scheduledHHMM}`));
      const cutoff = nowHHMM(-DUE_GRACE_MIN);

      const due: DueDose[] = [];
      for (const med of meds) {
        for (const reminder of med.reminders) {
          if (!reminder.enabled) continue;
          if (reminder.timeHHMM > cutoff) continue;
          if (answered.has(`${med.id}@${reminder.timeHHMM}`)) continue;
          due.push({
            medicationId: med.id,
            medicationName: med.name,
            amount: [med.dose, med.unit].filter((x) => x.trim()).join(''),
            scheduledHHMM: reminder.timeHHMM,
          });
        }
      }

      // Oldest first: the dose furthest in the past is the one whose details
      // are hardest to recall, so it is asked while it is least stale.
      due.sort((a, b) => a.scheduledHHMM.localeCompare(b.scheduledHHMM));
      setQueue(due);
    } catch (e) {
      // A prompt that cannot load is a prompt that does not appear. Nothing
      // downstream depends on it, and the Medication section is unaffected.
      console.error('[dose-prompt] load failed', e);
    }
  }, [dogId]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const current = queue[0];

  /** Hide the whole queue until the app is next launched. Records nothing. */
  const dismiss = useCallback(() => {
    dismissed.current = true;
    setQueue([]);
  }, []);

  const answer = async (status: DoseStatus) => {
    if (!current || busy) return;
    setBusy(true);
    try {
      await medicationRepo.recordDose({
        medicationId: current.medicationId,
        dogId,
        status,
        scheduledHHMM: current.scheduledHHMM,
      });
      // Shift rather than reload: the answer is already known, and re-reading
      // would flash the dialog closed and open again on the next dose.
      setQueue((prev) => prev.slice(1));
      onRecorded?.();
    } catch (e) {
      console.error('[dose-prompt] record failed', e);
      // Left on the queue on purpose. Nothing was written, so nothing should
      // look answered.
    } finally {
      setBusy(false);
    }
  };

  if (!current) return null;

  return (
    // No escape while a write is in flight; otherwise the back gesture does
    // what "Not now" does, which is what a person expects it to do.
    <Dialog visible onRequestClose={busy ? undefined : dismiss}>
      <Heading>
        Did {dogName} get {current.medicationName}?
      </Heading>

      <Body style={styles.body}>
        The {formatTimeOfDay(current.scheduledHHMM)} dose
        {current.amount ? ` · ${current.amount}` : ''}
        {queue.length > 1 ? ` · ${queue.length - 1} more to answer` : ''}
      </Body>

      <View style={styles.answers}>
        {ANSWERS.map(({ status, fill, ink }) => (
          <Pressable
            key={status}
            onPress={() => void answer(status)}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={DOSE_STATUS_LABEL[status]}
            style={({ pressed }) => [
              styles.answer,
              styles[fill],
              pressed && styles.pressed,
              busy && styles.disabled,
            ]}
          >
            <Text style={[styles.answerLabel, styles[ink]]}>
              {DOSE_STATUS_LABEL[status]}
            </Text>
          </Pressable>
        ))}
      </View>

      {/*
        Quiet, and last. It is a real option — an owner who genuinely does not
        know yet must not be forced to guess on a medication record — but it
        is not one of the three answers, so it does not look like one.
      */}
      <Pressable
        onPress={dismiss}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel="Not now"
        accessibilityHint="Hides this until you next open the app. Nothing is recorded."
        hitSlop={8}
        style={styles.later}
      >
        <Muted style={styles.laterLabel}>Not now</Muted>
      </Pressable>
    </Dialog>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 21, marginBottom: spacing.xs },

  answers: { gap: spacing.sm },
  answer: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
  },
  /*
   * Tinted, not filled. Three saturated buttons in a column would make the
   * dialog read as three warnings; these are three neutral reports of what
   * happened, and only their colour distinguishes them.
   */
  good: { backgroundColor: colors.tealTint, borderColor: colors.tealTint },
  warn: { backgroundColor: colors.amberTint, borderColor: colors.amberTint },
  bad: { backgroundColor: colors.redTint, borderColor: colors.redTint },
  answerLabel: { fontSize: fontSize.md, fontWeight: '700', fontFamily: fontFamily.bold },
  goodLabel: { color: colors.tealDeep },
  warnLabel: { color: colors.amberInk },
  badLabel: { color: colors.redDeep },

  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.5 },

  later: { alignSelf: 'center', paddingVertical: spacing.sm },
  laterLabel: { fontSize: fontSize.sm, fontFamily: fontFamily.semibold },
});
