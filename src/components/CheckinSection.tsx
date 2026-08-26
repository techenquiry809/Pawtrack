/**
 * The daily check-in form.
 *
 * ── WHY THIS MATTERS ──────────────────────────────────────────────────
 *
 * This is the control dataset. Without ordinary days to compare against,
 * every "pattern" the analytics engine finds is measured against nothing.
 * That is why the whole design target is thirty seconds: sliders and taps,
 * one optional text box, and no required field anywhere.
 *
 * ── ONE PER DAY IS A DATABASE GUARANTEE ───────────────────────────────
 *
 * Opening this twice in a day edits one row. That is enforced by a unique
 * index on (dog_id, check_in_date) plus an INSERT ... ON CONFLICT in
 * checkinRepo — NOT by this component remembering it already saved. Screen
 * state cannot be trusted for a uniqueness rule.
 */

import { useCallback, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { useFocusEffect } from 'expo-router';

import { Body, Button, Card, Heading, Muted, Pill, SegmentedControl } from '@/components/ui';
import { CheckinCalendar } from '@/components/CheckinCalendar';
import { Icon } from '@/components/Icon';
import { colors, fontSize, radius, spacing, MIN_TOUCH_TARGET } from '@/theme/tokens';
import * as checkinRepo from '@/db/checkinRepo';
import { localDayKey } from '@/utils/time';
import type { DailyCheckin } from '@/types/domain';

type Appetite = DailyCheckin['appetite'];
type Water = DailyCheckin['water'];
type Gi = DailyCheckin['gi'];

const SLEEP_STEPS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

export function CheckinSection({ dogId, dogName }: { dogId: string; dogName: string }) {
  const [existing, setExisting] = useState<DailyCheckin | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Which day this form is editing. Defaults to today; the calendar can point
  // it at a missed day so the same form backfills it.
  const [targetDate, setTargetDate] = useState(localDayKey());
  const [calendarOpen, setCalendarOpen] = useState(false);
  // Every check-in keyed by its local day. The calendar needs the whole record
  // now, not just which days exist, so it can show what was logged.
  const [records, setRecords] = useState<Map<string, DailyCheckin>>(new Map());

  const [sleepHrs, setSleepHrs] = useState<number | null>(null);
  const [appetite, setAppetite] = useState<Appetite>('normal');
  const [water, setWater] = useState<Water>('normal');
  const [energy, setEnergy] = useState(3);
  const [stress, setStress] = useState(2);
  const [medOnTime, setMedOnTime] = useState(true);
  const [gi, setGi] = useState<Gi>('none');
  const [unusual, setUnusual] = useState('');

  const resetForm = () => {
    setSleepHrs(null);
    setAppetite('normal');
    setWater('normal');
    setEnergy(3);
    setStress(2);
    setMedOnTime(true);
    setGi('none');
    setUnusual('');
  };

  /**
   * Loads whichever day the form is pointed at, so reopening EDITS rather than
   * starting blank — and switching to a missed day clears the previous day's
   * answers instead of silently carrying them over, which would fabricate
   * observations for a day the owner never described.
   */
  const load = useCallback(async () => {
    try {
      const all = await checkinRepo.listCheckins(dogId);
      setRecords(new Map(all.map((c) => [c.checkInDate, c])));
      const row = all.find((c) => c.checkInDate === targetDate) ?? null;
      setExisting(row);
      if (!row) {
        resetForm();
        return;
      }
      setSleepHrs(row.sleepHrs);
      setAppetite(row.appetite);
      setWater(row.water);
      setEnergy(row.energy);
      setStress(row.stress);
      setMedOnTime(row.medOnTime);
      setGi(row.gi);
      setUnusual(row.unusual);
    } catch (e) {
      console.error('[checkin] load failed', e);
    } finally {
      setLoaded(true);
    }
  }, [dogId, targetDate]);

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

  const onSave = async () => {
    setSaving(true);
    try {
      await checkinRepo.upsertCheckinForDate(dogId, targetDate, {
        sleepHrs, appetite, water, energy, stress, medOnTime, gi,
        unusual: unusual.trim(),
      });
      await load();
      setSaved(true);
    } catch (e) {
      console.error('[checkin] save failed', e);
    } finally {
      setSaving(false);
    }
  };

  const isToday = targetDate === localDayKey();
  const targetLabel = isToday
    ? 'Today'
    : new Date(`${targetDate}T12:00:00`).toLocaleDateString(undefined, {
        weekday: 'long', day: 'numeric', month: 'long',
      });

  return (
    <>
      <Card>
        <View style={styles.row}>
          <Heading>{targetLabel}</Heading>
          <Pill
            label={existing ? (existing.backfilled ? 'Filled in later' : 'Saved') : 'Not yet'}
            tone={existing ? (existing.backfilled ? 'teal' : 'green') : 'amber'}
          />
        </View>
        <Muted style={{ marginTop: 4 }}>
          {existing
            ? `Saving again updates this day — you will never end up with two.`
            : isToday
              ? 'About thirty seconds. Every question is optional.'
              : 'Filling this in from memory. It will be marked as recorded later.'}
        </Muted>

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

        {!isToday && (
          <Pressable
            onPress={() => setTargetDate(localDayKey())}
            accessibilityRole="button"
            accessibilityLabel="Back to today"
            style={({ pressed }) => [styles.backToToday, pressed && styles.pressed]}
          >
            <Muted style={styles.backToTodayLabel}>Back to today</Muted>
          </Pressable>
        )}
      </Card>

      <CheckinCalendar
        visible={calendarOpen}
        onClose={() => setCalendarOpen(false)}
        records={records}
        dogName={dogName}
        onPickDate={(dayKey) => {
          setTargetDate(dayKey);
          setCalendarOpen(false);
          setSaved(false);
        }}
      />

      {/* --- Sleep ------------------------------------------------- */}
      <Card>
        <Heading>Hours slept</Heading>
        <Muted style={styles.hint}>Roughly is fine.</Muted>
        <View style={styles.scaleRow}>
          {SLEEP_STEPS.map((h) => (
            <Pressable
              key={h}
              onPress={() => setSleepHrs(sleepHrs === h ? null : h)}
              accessibilityRole="radio"
              accessibilityState={{ selected: sleepHrs === h }}
              accessibilityLabel={`${h} hours`}
              style={({ pressed }) => [
                styles.scaleCell,
                sleepHrs === h && styles.scaleCellOn,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.scaleText, sleepHrs === h && styles.scaleTextOn]}>
                {h}
              </Text>
            </Pressable>
          ))}
        </View>
      </Card>

      {/* --- Appetite / water --------------------------------------- */}
      <Card>
        <Heading>Appetite</Heading>
        <View style={styles.control}>
          <SegmentedControl<Appetite>
            accessibilityLabel="Appetite"
            value={appetite}
            onChange={setAppetite}
            options={[
              { value: 'decreased', label: 'Less' },
              { value: 'normal', label: 'Normal' },
              { value: 'increased', label: 'More' },
            ]}
          />
        </View>

        <Heading style={styles.spacedHeading}>Water</Heading>
        <View style={styles.control}>
          <SegmentedControl<Water>
            accessibilityLabel="Water intake"
            value={water}
            onChange={setWater}
            options={[
              { value: 'decreased', label: 'Less' },
              { value: 'normal', label: 'Normal' },
              { value: 'increased', label: 'More' },
            ]}
          />
        </View>
      </Card>

      {/* --- Energy / stress ---------------------------------------- */}
      <Card>
        <Rating label="Energy" low="Flat" high="Bouncy" value={energy} onChange={setEnergy} />
        <View style={styles.spacedHeading}>
          <Rating label="Stress" low="Calm" high="Anxious" value={stress} onChange={setStress} />
        </View>
      </Card>

      {/* --- Medication / GI ---------------------------------------- */}
      <Card>
        <Heading>Medication given on time</Heading>
        <Muted style={styles.hint}>
          Leave this as it is if there is no medication to give.
        </Muted>
        <View style={styles.control}>
          <SegmentedControl<'yes' | 'no'>
            accessibilityLabel="Was medication given on time"
            value={medOnTime ? 'yes' : 'no'}
            onChange={(v) => setMedOnTime(v === 'yes')}
            options={[
              { value: 'yes', label: 'Yes' },
              { value: 'no', label: 'No' },
            ]}
          />
        </View>

        <Heading style={styles.spacedHeading}>Vomiting or diarrhea</Heading>
        <View style={styles.control}>
          <SegmentedControl<Gi>
            accessibilityLabel="Vomiting or diarrhea"
            value={gi}
            onChange={setGi}
            options={[
              { value: 'none', label: 'None' },
              { value: 'vomit', label: 'Vomit' },
              { value: 'diarrhea', label: 'Diarrhea' },
              { value: 'both', label: 'Both' },
            ]}
          />
        </View>
      </Card>

      {/* --- Free text ---------------------------------------------- */}
      <Card>
        <Heading>Anything unusual today</Heading>
        <TextInput
          style={styles.input}
          value={unusual}
          onChangeText={(t) => {
            setUnusual(t);
            setSaved(false);
          }}
          multiline
          maxLength={500}
          placeholder="Optional"
          placeholderTextColor={colors.inkSoft}
          accessibilityLabel="Anything unusual today"
        />
      </Card>

      <Button
        label={
          existing
            ? 'Update check-in'
            : isToday
              ? 'Save check-in'
              : `Save for ${targetLabel}`
        }
        large
        loading={saving}
        disabled={!loaded}
        onPress={() => void onSave()}
      />
      {saved && (
        <Text style={styles.savedNote} accessibilityLiveRegion="polite">
          Saved.
        </Text>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A 1–5 scale as five tap targets rather than a slider. A slider is fiddly to
 * land exactly with one hand, and these values are compared numerically later.
 */
function Rating({
  label,
  low,
  high,
  value,
  onChange,
}: {
  label: string;
  low: string;
  high: string;
  value: number;
  onChange: (next: number) => void;
}) {
  return (
    <View>
      <Heading>{label}</Heading>
      <View style={styles.scaleRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === n }}
            accessibilityLabel={`${label} ${n} of 5`}
            style={({ pressed }) => [
              styles.ratingCell,
              value === n && styles.scaleCellOn,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.scaleText, value === n && styles.scaleTextOn]}>{n}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.rangeLabels}>
        <Muted>{low}</Muted>
        <Muted>{high}</Muted>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  hint: { marginTop: 4 },
  control: { marginTop: spacing.sm },
  spacedHeading: { marginTop: spacing.lg },
  pressed: { opacity: 0.7 },

  scaleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: spacing.sm },
  scaleCell: {
    minWidth: 44,
    minHeight: 44,
    paddingHorizontal: 6,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  ratingCell: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  scaleCellOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  scaleText: { fontSize: fontSize.base, fontWeight: '700', color: colors.ink },
  scaleTextOn: { color: '#fff' },
  rangeLabels: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 6,
  },

  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    minHeight: 88,
    fontSize: fontSize.base,
    color: colors.ink,
    marginTop: spacing.sm,
    textAlignVertical: 'top',
  },

  calendarBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  calendarLabel: { flex: 1, fontWeight: '600' },
  backToToday: { minHeight: 40, justifyContent: 'center' },
  backToTodayLabel: { color: colors.tealDeep, fontWeight: '700' },

  savedNote: {
    textAlign: 'center',
    marginTop: spacing.sm,
    color: colors.greenInk,
    fontWeight: '600',
  },
});
