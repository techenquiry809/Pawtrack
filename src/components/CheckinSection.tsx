/**
 * The check-in's home on the tab: what state today is in, and the way in.
 *
 * ── WHAT MOVED OUT, AND WHY ───────────────────────────────────────────
 *
 * This used to BE the form — six stacked cards covering sleep, appetite, water,
 * energy, stress, medication, gut and a free-text note, all on one scroll. The
 * fields were right and the presentation was not: everything is optional, so
 * the owner was shown a wall of controls with no signal about how much of it
 * they were expected to answer, and no visible end.
 *
 * The form now lives in app/checkin-flow.tsx as five steps. What is left here
 * is the part the tab actually needs to show at a glance:
 *
 *   - whether today is recorded yet, and whether it was filled in later
 *   - a way into the flow
 *   - the calendar, for finding a day that was missed
 *
 * ── ONE PER DAY IS STILL A DATABASE GUARANTEE ─────────────────────────
 *
 * Unchanged: a unique index on (dog_id, check_in_date) plus INSERT ... ON
 * CONFLICT in checkinRepo. Entering the flow twice in a day edits one row.
 */

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Body, Button, Card, Heading, Muted, Pill } from '@/components/ui';
import { CheckinCalendar } from '@/components/CheckinCalendar';
import { TodaysDoses } from '@/components/TodaysDoses';
import { Icon } from '@/components/Icon';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, spacing } from '@/theme/tokens';
import * as checkinRepo from '@/db/checkinRepo';
import * as videoRepo from '@/db/videoRepo';
import { localDayKey } from '@/utils/time';
import type { DailyCheckin } from '@/types/domain';

export function CheckinSection({ dogId, dogName }: { dogId: string; dogName: string }) {
  const router = useRouter();

  const [loaded, setLoaded] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Every check-in keyed by its local day. The calendar needs the whole record,
  // not just which days exist, so it can show what was logged.
  const [records, setRecords] = useState<Map<string, DailyCheckin>>(new Map());
  /** Local days holding at least one seizure video, for the calendar's dot. */
  const [videoDays, setVideoDays] = useState<Set<string>>(new Set());

  const today = localDayKey();
  const existing = records.get(today) ?? null;

  const load = useCallback(async () => {
    try {
      const [all, gallery] = await Promise.all([
        checkinRepo.listCheckins(dogId),
        // Best-effort: the calendar is still useful without the dots, so a
        // gallery read that fails must not cost the owner their check-in view.
        videoRepo.listGallery(dogId).catch(() => []),
      ]);
      setRecords(new Map(all.map((c) => [c.checkInDate, c])));
      setVideoDays(new Set(gallery.map((g) => localDayKey(g.video.timestamp))));
    } catch (e) {
      console.error('[checkin] load failed', e);
    } finally {
      setLoaded(true);
    }
  }, [dogId]);

  // Reloads on focus, so returning from the flow shows the new state without
  // this component needing to know the flow saved.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const open = (date: string) => router.push(`/checkin-flow?date=${date}`);

  return (
    <>
      <Card>
        <View style={styles.row}>
          <Heading>Today</Heading>
          {/*
            The pill is shown only when it says something the control below it
            does not. "Not yet" and "Filled in later" both do; a green "Saved"
            over a green "Updated ✓" is the same fact twice, six points apart,
            and the eye reads the repetition as two different states before it
            reads the words.
          */}
          {!existing && <Pill label="Not yet" tone="amber" />}
          {existing?.backfilled && <Pill label="Filled in later" tone="teal" />}
        </View>
        <Muted style={styles.hint}>
          {existing
            ? 'Going through it again updates today — you will never end up with two.'
            : 'Five short questions, about thirty seconds. Every one is optional.'}
        </Muted>

        {existing ? (
          <RecordedToday onPress={() => open(today)} disabled={!loaded} />
        ) : (
          <Button
            label="Start check-in"
            onPress={() => open(today)}
            disabled={!loaded}
            accessibilityHint="Opens the check-in questions"
            style={styles.startBtn}
          />
        )}
      </Card>

      {/*
        Today's doses, directly under today's check-in.

        They were on the Medication tab, repeated once per drug. This is the
        screen the daily ritual happens on, so the daily medication belongs
        here — one list, in clock order. It renders nothing at all when no
        medication is prescribed. See components/TodaysDoses.tsx.
      */}
      <TodaysDoses dogId={dogId} />

      <Card>
        <Pressable
          onPress={() => setCalendarOpen(true)}
          accessibilityRole="button"
          accessibilityLabel="See which days you have checked in"
          style={({ pressed }) => [styles.calendarBtn, pressed && styles.pressed]}
        >
          <Icon name="calendar" size="md" color={colors.tealDeep} />
          <Body style={styles.calendarLabel}>See missed days</Body>
          <Icon name="chevron" size="md" color={colors.inkSoft} />
        </Pressable>
      </Card>

      <CheckinCalendar
        visible={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        records={records}
        videoDays={videoDays}
        dogName={dogName}
        onPickDate={(dayKey) => {
          setCalendarOpen(false);
          // The same flow backfills a missed day; it reads the date from the
          // route, so there is only one form to keep correct.
          open(dayKey);
        }}
      />
    </>
  );
}

/**
 * Today, once it has been recorded.
 *
 * ── WHY THIS IS NOT THE PRIMARY BUTTON ────────────────────────────────
 *
 * It was: the same saturated teal fill as "Start check-in", relabelled "Update
 * today". A filled primary button is the app asking for something, and it went
 * on asking after the owner had already done it — the strongest control on the
 * screen, pointed at the one task with nothing left to do. On a daily ritual
 * that reads as nagging, and it hides the answer to the question the owner
 * actually opened the tab with, which is "did I do this today?".
 *
 * So the control now ANSWERS first and offers second. The tick and the word
 * are the state; the line under them is the affordance. It is still one tap
 * into the same flow — an owner who wants to change an answer must never have
 * to hunt for the way back in — but it no longer competes for attention with
 * the doses and the missed-days row below it.
 *
 * ── THE VISUAL RULES IT FOLLOWS ───────────────────────────────────────
 *
 * Green, not teal. Teal is this app's ACTION colour, on every primary button
 * and every link; green is reserved for status — see the note on the event
 * palette in theme/tokens.ts, which frees green for exactly this by keeping
 * amber as the warning hue for red-green colour-blind readers.
 *
 * The tick is a glyph on a tinted disc rather than a bare mark, so the state
 * survives a screenshot at arm's length and does not rely on colour alone: the
 * word "Updated" carries the same meaning with the hue removed entirely.
 *
 * `radius.card` on a control this tall on purpose. `radius.control` is 100 —
 * fully round — which is right for a single-line button and collapses a
 * two-line box into a lozenge, the same trap `radius.field` exists to avoid.
 */
function RecordedToday({
  onPress,
  disabled,
}: {
  onPress: () => void;
  disabled: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      // The role already says "button", so the label carries the state and the
      // hint carries the action — a screen reader announces what is true before
      // it announces what is possible, in the same order as the visual design.
      accessibilityLabel="Today's check-in is updated"
      accessibilityHint="Opens the check-in questions to change today's answers"
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.recorded,
        pressed && styles.pressed,
        disabled && styles.recordedDisabled,
      ]}
    >
      <View style={styles.recordedTick}>
        <Icon name="check" size="md" color={colors.greenInk} />
      </View>

      <View style={styles.recordedText}>
        <Text style={styles.recordedTitle}>Updated</Text>
        <Text style={styles.recordedHint}>Tap to change today’s answers</Text>
      </View>

      <Icon name="chevron" size="md" color={colors.green} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { marginTop: 4 },
  startBtn: { marginTop: spacing.md },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },

  recorded: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.md,
    // Tinted fill plus a hairline of the full-strength hue. The tint alone
    // floats on the card's white; the border is what gives it an edge to sit
    // on without the weight of a shadow, which would claim it is a raised
    // control the way the primary button is.
    backgroundColor: colors.greenTint,
    borderWidth: 1,
    borderColor: colors.green,
    borderRadius: radius.card,
    // The box is already well over MIN_TOUCH_TARGET from its padding; stated
    // anyway so a future padding change cannot quietly shrink it under 48.
    minHeight: MIN_TOUCH_TARGET,
  },
  // Only while the day's records are still loading, which is a blink. Dimmed
  // rather than restyled, so nothing moves when it becomes live.
  recordedDisabled: { opacity: 0.6 },
  recordedTick: {
    width: 32,
    height: 32,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  recordedText: { flex: 1 },
  recordedTitle: {
    fontFamily: fontFamily.bold,
    fontSize: fontSize.md,
    color: colors.greenInk,
  },
  recordedHint: {
    marginTop: 2,
    fontFamily: fontFamily.regular,
    fontSize: fontSize.sm,
    color: colors.inkSoft,
  },
  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.control,
  },
  calendarLabel: { flex: 1, fontFamily: fontFamily.semibold },
});
