/**
 * The daily check-in, one question at a time.
 *
 * ── WHY THIS IS A FLOW AND NOT A FORM ─────────────────────────────────
 *
 * It used to be six cards stacked on one scroll: sleep, appetite, water,
 * energy, stress, medication, GI and a note, all visible at once. Every one of
 * those is optional, which is the right data model and the wrong screen — an
 * owner opening it saw a wall of controls and had no way to tell how much of it
 * they were expected to answer. The thirty-second target was true and did not
 * look true.
 *
 * Splitting it into five steps does not remove a single field. It changes what
 * the owner is asked to hold in their head: one decision per screen, a visible
 * position in a short sequence, and an end they can see coming.
 *
 * ── WHY NOTHING SAVES UNTIL THE LAST STEP ─────────────────────────────
 *
 * Autosaving each step would write a partial row the moment someone opened the
 * flow and walked away — a check-in claiming "appetite normal, water normal"
 * for a day nobody actually described. That row then enters the control dataset
 * the analytics compare seizure days against, so a half-abandoned form would
 * quietly become evidence. One write, at the end, on purpose.
 *
 * The cost is that abandoning the flow loses the answers, so leaving with
 * changes asks first.
 *
 * ── ONE ROW PER DAY IS STILL A DATABASE GUARANTEE ─────────────────────
 *
 * Unchanged from the old form: a unique index on (dog_id, check_in_date) plus
 * INSERT ... ON CONFLICT in checkinRepo. Reopening this flow for a day already
 * recorded edits that row. Screen state is not what enforces it.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body, Button, Card, Heading, Muted, SegmentedControl, Title,
} from '@/components/ui';
import { Icon } from '@/components/Icon';
import {
  colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, spacing,
} from '@/theme/tokens';
import * as checkinRepo from '@/db/checkinRepo';
import { useActiveDog } from '@/store/appStore';
import { formatFullDate, localDayKey } from '@/utils/time';
import type { DailyCheckin } from '@/types/domain';

type Appetite = DailyCheckin['appetite'];
type Water = DailyCheckin['water'];
type Gi = DailyCheckin['gi'];

const SLEEP_STEPS = [0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24];

/**
 * The sequence.
 *
 * Grouped by what the owner is remembering, not by data type. Appetite and
 * water are one memory ("did they eat and drink normally"); energy and stress
 * are one impression of the dog's mood; medication and gut are the two things
 * that most often go together on a bad day.
 */
const STEPS = [
  { key: 'sleep', title: 'Hours slept', hint: 'Roughly is fine.' },
  { key: 'intake', title: 'Eating and drinking', hint: 'Compared with a normal day.' },
  { key: 'mood', title: 'Energy and stress', hint: 'How they seemed overall.' },
  { key: 'health', title: 'Medication and gut', hint: 'Both are common on a bad day.' },
  { key: 'review', title: 'Ready to save', hint: 'Add a note if something stood out.' },
] as const;

const LAST = STEPS.length - 1;

export default function CheckinFlowScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const dog = useActiveDog();

  // Which day this flow is recording. The tab passes the day the owner picked
  // from the calendar, so backfilling a missed day uses this same flow.
  const params = useLocalSearchParams<{ date?: string }>();
  const targetDate = params.date ?? localDayKey();

  const [step, setStep] = useState(0);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [existing, setExisting] = useState<DailyCheckin | null>(null);
  const [dirty, setDirty] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);

  const [sleepHrs, setSleepHrs] = useState<number | null>(null);
  const [appetite, setAppetite] = useState<Appetite>('normal');
  const [water, setWater] = useState<Water>('normal');
  const [energy, setEnergy] = useState(3);
  const [stress, setStress] = useState(2);
  const [medOnTime, setMedOnTime] = useState(true);
  const [gi, setGi] = useState<Gi>('none');
  const [unusual, setUnusual] = useState('');

  /**
   * Marks the form dirty on every edit.
   *
   * Wrapping each setter rather than diffing against the loaded row: a diff
   * would call a re-selected identical value "clean", and the owner who tapped
   * three things and landed back where they started would still lose nothing
   * by leaving — but would also get no warning if they had genuinely changed
   * something and changed it back. Treating any interaction as dirty is the
   * side to err on when the cost of being wrong is a lost check-in.
   */
  const edit = <T,>(setter: (v: T) => void) => (v: T) => {
    setter(v);
    setDirty(true);
  };

  useEffect(() => {
    if (!dog) return;
    let cancelled = false;
    (async () => {
      try {
        const row = await checkinRepo.getCheckinForDate(dog.id, targetDate);
        if (cancelled) return;
        setExisting(row);
        if (row) {
          setSleepHrs(row.sleepHrs);
          setAppetite(row.appetite);
          setWater(row.water);
          setEnergy(row.energy);
          setStress(row.stress);
          setMedOnTime(row.medOnTime);
          setGi(row.gi);
          setUnusual(row.unusual);
          // An existing note is already worth seeing without hunting for it.
          if (row.unusual) setNoteOpen(true);
        }
      } catch (e) {
        console.error('[checkin-flow] load failed', e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => { cancelled = true; };
  }, [dog, targetDate]);

  const isToday = targetDate === localDayKey();
  const dayLabel = useMemo(
    () => (isToday
      ? 'Today'
      : formatFullDate(new Date(`${targetDate}T12:00:00`).getTime())),
    [isToday, targetDate],
  );

  const leave = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace('/(tabs)/checkin');
  }, [router]);

  /** Leaving mid-flow discards everything, so it asks rather than assuming. */
  const onClose = useCallback(() => {
    if (!dirty) {
      leave();
      return;
    }
    Alert.alert(
      'Leave without saving?',
      'Nothing is recorded until you save, so these answers will be lost.',
      [
        { text: 'Keep answering', style: 'cancel' },
        { text: 'Discard', style: 'destructive', onPress: leave },
      ],
    );
  }, [dirty, leave]);

  const onSave = useCallback(async () => {
    if (!dog || saving) return;
    setSaving(true);
    try {
      await checkinRepo.upsertCheckinForDate(dog.id, targetDate, {
        sleepHrs, appetite, water, energy, stress, medOnTime, gi,
        unusual: unusual.trim(),
      });
      leave();
    } catch (e) {
      console.error('[checkin-flow] save failed', e);
      Alert.alert(
        'Could not save',
        'Something went wrong writing this check-in. Please try again.',
      );
      setSaving(false);
    }
  }, [dog, saving, targetDate, sleepHrs, appetite, water, energy, stress,
      medOnTime, gi, unusual, leave]);

  if (!dog) return null;

  const current = STEPS[step] ?? STEPS[0];

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.sm }]}>
      {/* --- Header ------------------------------------------------- */}
      <View style={styles.header}>
        <Pressable
          onPress={onClose}
          accessibilityRole="button"
          accessibilityLabel="Close the check-in"
          hitSlop={10}
          style={({ pressed }) => [styles.closeBtn, pressed && styles.pressed]}
        >
          <Icon name="clear" size="md" color={colors.ink} />
        </Pressable>
        <View style={styles.flexOne}>
          <Muted style={styles.dayLabel}>{dayLabel}</Muted>
        </View>
        <Text style={styles.counter}>
          {step + 1} of {STEPS.length}
        </Text>
      </View>

      {/* Progress. A bar rather than dots: five dots at this width are smaller
          than the eye reads as progress, and the bar also works when a step is
          added later. */}
      <View style={styles.track} accessibilityRole="progressbar">
        <View style={[styles.fill, { width: `${((step + 1) / STEPS.length) * 100}%` }]} />
      </View>

      <ScrollView
        style={styles.flexOne}
        contentContainerStyle={styles.content}
        keyboardShouldPersistTaps="handled"
      >
        <Title style={styles.stepTitle}>{current.title}</Title>
        <Muted style={styles.stepHint}>{current.hint}</Muted>

        {/* --- 1. Sleep --------------------------------------------- */}
        {current.key === 'sleep' && (
          <Card>
            <View style={styles.scaleRow}>
              {SLEEP_STEPS.map((h) => (
                <Pressable
                  key={h}
                  onPress={() => edit(setSleepHrs)(sleepHrs === h ? null : h)}
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
            <Muted style={styles.optionalNote}>
              Tap the same number again to clear it. Leaving it blank is fine.
            </Muted>
          </Card>
        )}

        {/* --- 2. Appetite and water --------------------------------- */}
        {current.key === 'intake' && (
          <Card>
            <Heading>Appetite</Heading>
            <View style={styles.control}>
              <SegmentedControl<Appetite>
                accessibilityLabel="Appetite"
                value={appetite}
                onChange={edit(setAppetite)}
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
                onChange={edit(setWater)}
                options={[
                  { value: 'decreased', label: 'Less' },
                  { value: 'normal', label: 'Normal' },
                  { value: 'increased', label: 'More' },
                ]}
              />
            </View>
          </Card>
        )}

        {/* --- 3. Energy and stress ---------------------------------- */}
        {current.key === 'mood' && (
          <Card>
            <Rating
              label="Energy" low="Flat" high="Bouncy"
              value={energy} onChange={edit(setEnergy)}
            />
            <View style={styles.spacedHeading}>
              <Rating
                label="Stress" low="Calm" high="Anxious"
                value={stress} onChange={edit(setStress)}
              />
            </View>
          </Card>
        )}

        {/* --- 4. Medication and gut --------------------------------- */}
        {current.key === 'health' && (
          <Card>
            <Heading>Medication given on time</Heading>
            <Muted style={styles.hint}>
              Leave this as it is if there is no medication to give.
            </Muted>
            <View style={styles.control}>
              <SegmentedControl<'yes' | 'no'>
                accessibilityLabel="Was medication given on time"
                value={medOnTime ? 'yes' : 'no'}
                onChange={(v) => edit(setMedOnTime)(v === 'yes')}
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
                onChange={edit(setGi)}
                options={[
                  { value: 'none', label: 'None' },
                  { value: 'vomit', label: 'Vomit' },
                  { value: 'diarrhea', label: 'Diarrhea' },
                  { value: 'both', label: 'Both' },
                ]}
              />
            </View>
          </Card>
        )}

        {/* --- 5. Review and save ------------------------------------ */}
        {current.key === 'review' && (
          <>
            {/* A recap, so Save is never a blind press. Four steps back is too
                far to scroll through to check one answer. */}
            <Card>
              <Recap label="Hours slept" value={sleepHrs === null ? 'Not recorded' : `${sleepHrs} hours`} />
              <Recap label="Appetite" value={APPETITE_LABEL[appetite]} />
              <Recap label="Water" value={APPETITE_LABEL[water]} />
              <Recap label="Energy" value={`${energy} of 5`} />
              <Recap label="Stress" value={`${stress} of 5`} />
              <Recap label="Medication" value={medOnTime ? 'Given on time' : 'Not on time'} />
              <Recap label="Vomiting or diarrhea" value={GI_LABEL[gi]} last />
            </Card>

            {noteOpen ? (
              <Card>
                <Heading>Anything unusual</Heading>
                <TextInput
                  style={styles.input}
                  value={unusual}
                  onChangeText={edit(setUnusual)}
                  multiline
                  maxLength={500}
                  autoFocus={!unusual}
                  placeholder="What stood out about today?"
                  placeholderTextColor={colors.inkSoft}
                  accessibilityLabel="Anything unusual today"
                />
              </Card>
            ) : (
              <Pressable
                onPress={() => setNoteOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Add something unusual"
                style={({ pressed }) => [styles.addNote, pressed && styles.pressed]}
              >
                <Icon name="edit" size="sm" color={colors.tealDeep} />
                <Body style={styles.addNoteLabel}>Add something unusual</Body>
              </Pressable>
            )}
          </>
        )}
      </ScrollView>

      {/* --- Footer navigation -------------------------------------- */}
      <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
        <Button
          label="Back"
          variant="ghost"
          onPress={() => (step === 0 ? onClose() : setStep(step - 1))}
          accessibilityHint={step === 0 ? 'Closes the check-in' : 'Goes to the previous question'}
          style={styles.navBtn}
        />
        {step === LAST ? (
          <Button
            label={existing ? 'Update check-in' : 'Save check-in'}
            onPress={() => void onSave()}
            loading={saving}
            disabled={!loaded}
            accessibilityHint={`Records this check-in for ${dayLabel}`}
            style={styles.navBtnWide}
          />
        ) : (
          <Button
            label="Next"
            onPress={() => setStep(step + 1)}
            disabled={!loaded}
            accessibilityHint="Goes to the next question"
            style={styles.navBtnWide}
          />
        )}
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */

const APPETITE_LABEL: Record<Appetite | Water, string> = {
  decreased: 'Less than usual',
  normal: 'Normal',
  increased: 'More than usual',
};

const GI_LABEL: Record<Gi, string> = {
  none: 'None',
  vomit: 'Vomiting',
  diarrhea: 'Diarrhea',
  both: 'Both',
};

function Recap({ label, value, last }: { label: string; value: string; last?: boolean }) {
  return (
    <View style={[styles.recapRow, last && styles.recapLast]}>
      <Muted style={styles.recapLabel}>{label}</Muted>
      <Body style={styles.recapValue}>{value}</Body>
    </View>
  );
}

/**
 * A 1–5 scale as five tap targets rather than a slider. A slider is fiddly to
 * land exactly with one hand, and these values are compared numerically later.
 *
 * Moved here from CheckinSection along with the rest of the form.
 */
function Rating({
  label, low, high, value, onChange,
}: {
  label: string;
  low: string;
  high: string;
  value: number;
  onChange: (n: number) => void;
}) {
  return (
    <View>
      <Heading>{label}</Heading>
      <View style={styles.ratingRow}>
        {[1, 2, 3, 4, 5].map((n) => (
          <Pressable
            key={n}
            onPress={() => onChange(n)}
            accessibilityRole="radio"
            accessibilityState={{ selected: value === n }}
            accessibilityLabel={`${label} ${n} of 5`}
            style={({ pressed }) => [
              styles.ratingCell,
              value === n && styles.ratingCellOn,
              pressed && styles.pressed,
            ]}
          >
            <Text style={[styles.ratingText, value === n && styles.ratingTextOn]}>{n}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.ratingEnds}>
        <Muted style={styles.ratingEnd}>{low}</Muted>
        <Muted style={styles.ratingEnd}>{high}</Muted>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flexOne: { flex: 1 },
  pressed: { opacity: 0.9, transform: [{ scale: 0.98 }] },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingBottom: spacing.sm,
  },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20, // A circle: half of 40, not a step on the radius scale.
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  dayLabel: { textAlign: 'center' },
  counter: {
    fontSize: fontSize.sm,
    color: colors.inkSoft,
    fontFamily: fontFamily.semibold,
    fontVariant: ['tabular-nums'],
    minWidth: 52,
    textAlign: 'right',
  },

  track: {
    height: 4,
    marginHorizontal: spacing.lg,
    borderRadius: 2, // Half of 4 — a rounded end, not a scale step.
    backgroundColor: colors.line,
    overflow: 'hidden',
  },
  fill: { height: '100%', borderRadius: 2, backgroundColor: colors.teal },

  content: { padding: spacing.lg, paddingBottom: spacing.xl },
  stepTitle: { marginBottom: 2 },
  stepHint: { marginBottom: spacing.md },
  hint: { marginTop: 2 },
  optionalNote: { marginTop: spacing.md },
  control: { marginTop: spacing.sm },
  spacedHeading: { marginTop: spacing.lg },

  scaleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  scaleCell: {
    minWidth: 56,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  scaleCellOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  scaleText: { fontSize: fontSize.md, color: colors.ink, fontFamily: fontFamily.semibold },
  scaleTextOn: { color: colors.onMedia },

  ratingRow: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },
  ratingCell: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  ratingCellOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  ratingText: { fontSize: fontSize.md, color: colors.ink, fontFamily: fontFamily.semibold },
  ratingTextOn: { color: colors.onMedia },
  ratingEnds: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 4 },
  ratingEnd: { fontSize: fontSize.xs },

  recapRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  recapLast: { borderBottomWidth: 0 },
  recapLabel: { flex: 1 },
  recapValue: { fontFamily: fontFamily.semibold, textAlign: 'right' },

  addNote: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    borderRadius: radius.control,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.line,
    backgroundColor: colors.card,
    marginTop: spacing.md,
  },
  addNoteLabel: { color: colors.tealDeep, fontFamily: fontFamily.semibold },

  input: {
    minHeight: 96,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
    padding: spacing.md,
    marginTop: spacing.sm,
    fontSize: fontSize.md,
    color: colors.ink,
    fontFamily: fontFamily.regular,
    textAlignVertical: 'top',
  },

  footer: {
    flexDirection: 'row',
    gap: spacing.sm,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.card,
  },
  navBtn: { flex: 1 },
  navBtnWide: { flex: 2 },
});
