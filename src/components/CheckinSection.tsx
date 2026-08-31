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
import { Pressable, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Body, Button, Card, Heading, Muted, Pill } from '@/components/ui';
import { CheckinCalendar } from '@/components/CheckinCalendar';
import { Icon } from '@/components/Icon';
import { colors, fontFamily, MIN_TOUCH_TARGET, radius, spacing } from '@/theme/tokens';
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
          <Pill
            label={existing ? (existing.backfilled ? 'Filled in later' : 'Saved') : 'Not yet'}
            tone={existing ? (existing.backfilled ? 'teal' : 'green') : 'amber'}
          />
        </View>
        <Muted style={styles.hint}>
          {existing
            ? 'Going through it again updates today — you will never end up with two.'
            : 'Five short questions, about thirty seconds. Every one is optional.'}
        </Muted>

        <Button
          label={existing ? 'Update today' : 'Start check-in'}
          onPress={() => open(today)}
          disabled={!loaded}
          accessibilityHint="Opens the check-in questions"
          style={styles.startBtn}
        />
      </Card>

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

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { marginTop: 4 },
  startBtn: { marginTop: spacing.md },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },
  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.control,
  },
  calendarLabel: { flex: 1, fontFamily: fontFamily.semibold },
});
