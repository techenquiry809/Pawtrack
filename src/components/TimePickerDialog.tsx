/**
 * Pick a reminder time on a 12-hour clock.
 *
 * ── WHY NOT THE PLATFORM PICKER ───────────────────────────────────────
 *
 * `@react-native-community/datetimepicker` is not a dependency of this
 * project, and adding one for a single field is a native rebuild, a config
 * plugin entry and a permanent maintenance line for a control this app can
 * already draw out of its own parts. The stepper is also the pattern the app
 * has ALREADY taught: the seizure thresholds on the settings screen are
 * `− 3 min +`, and an owner who has set those knows how this works before they
 * touch it.
 *
 * ── WHY IT REPLACES A TEXT FIELD ──────────────────────────────────────
 *
 * Adding a custom time used to be a text input labelled "Other (HH:MM)",
 * validated against a regex, that rejected what people actually type — `8:00`,
 * `8 pm`, `20.00` — with "Use a 24-hour time like 08:00." That is the app
 * asking someone to work in a format they do not think in, to set an alarm for
 * a drug their dog needs. There is nothing to mistype here.
 *
 * ── AM/PM IS THE POINT, AND IT IS A SEGMENTED CONTROL ─────────────────
 *
 * Not a toggle. A toggle has an on-state and an off-state, and neither am nor
 * pm is the absence of the other — getting this wrong by twelve hours is the
 * single most consequential mistake available on this screen.
 *
 * The stored value stays 24-hour `HH:MM` throughout; see `formatTimeOfDay` in
 * utils/time.ts for why the two forms are kept apart.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Heading, SegmentedControl } from '@/components/ui';
import { Dialog } from '@/components/Dialog';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';

/**
 * MINUTES MOVE ONE AT A TIME. EVERY TIME IS REACHABLE.
 *
 * This used to step in fives, on the reasoning that "a dose is not a thing
 * anyone schedules to the minute" and that 60 single taps to cross an hour is a
 * control nobody finishes using.
 *
 * The second half of that was true and the first half was not ours to decide.
 * Owners in this app already had 5:30, 7:50, 8:00, 10:25 and 2:45 reminders on
 * one dog — real schedules are built around walks, meals, work and whatever the
 * vet actually said, and a picker that silently refuses 7:52 is the app
 * overruling a prescription. Worse, `parse` SNAPPED on open, so an existing
 * 07:07 reminder became 07:05 the moment someone looked at it, and saving an
 * unrelated edit wrote the changed time back.
 *
 * The tap-count problem is solved where it actually lives — in the button. Hold
 * either arrow and it repeats, accelerating; see HOLD_DELAY_MS below. An hour is
 * a second of holding, and no minute is unreachable.
 */
const MINUTE_STEP = 1;

/**
 * How long a press must be held before it starts repeating.
 *
 * Long enough that a deliberate single tap never fires twice — the cost of
 * getting this wrong is an owner nudging a reminder one minute and watching it
 * run away from them.
 */
const HOLD_DELAY_MS = 400;

/** Repeat interval once holding, and the faster one it accelerates into. */
const HOLD_INTERVAL_MS = 110;
const HOLD_FAST_MS = 35;

/**
 * Repeats at HOLD_INTERVAL_MS before dropping to HOLD_FAST_MS.
 *
 * Roughly a second of holding at the first speed, which covers a small
 * correction, before it opens up for someone crossing a whole hour.
 */
const HOLD_ACCELERATE_AFTER = 9;

type Meridiem = 'am' | 'pm';

/** '13:30' → { hour12: 1, minute: 30, meridiem: 'pm' } */
function parse(timeHHMM: string): { hour12: number; minute: number; meridiem: Meridiem } {
  const [h, m] = timeHHMM.split(':').map(Number);
  const hour = Number.isInteger(h) && h! >= 0 && h! <= 23 ? h! : 8;
  const minute = Number.isInteger(m) && m! >= 0 && m! <= 59 ? m! : 0;
  return {
    hour12: hour % 12 === 0 ? 12 : hour % 12,
    // Taken exactly as stored. It used to be snapped to the step so the − and +
    // buttons could return to it; at a step of one every minute is reachable,
    // so snapping now has nothing left to protect and would only be a way to
    // change a reminder nobody asked to change.
    minute,
    meridiem: hour < 12 ? 'am' : 'pm',
  };
}

/** The inverse. 12am → 00, 12pm → 12. */
function toHHMM(hour12: number, minute: number, meridiem: Meridiem): string {
  const base = hour12 % 12;
  const hour24 = meridiem === 'pm' ? base + 12 : base;
  return `${String(hour24).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

export type TimePickerDialogProps = {
  visible: boolean;
  /** Starting value as 'HH:MM'. */
  value: string;
  /** Shown above the clock — says whether this is a new time or an edit. */
  title: string;
  /** Called with the new 'HH:MM'. */
  onConfirm: (timeHHMM: string) => void;
  onCancel: () => void;
  /** Set when the chosen time is already taken; shown under the clock. */
  error?: string | null;
};

export function TimePickerDialog({
  visible,
  value,
  title,
  onConfirm,
  onCancel,
  error,
}: TimePickerDialogProps) {
  const [hour12, setHour12] = useState(8);
  const [minute, setMinute] = useState(0);
  const [meridiem, setMeridiem] = useState<Meridiem>('am');

  // Re-seeded every time it opens. Held in state rather than derived, because
  // the whole point is to edit it — but a stale value from the LAST time it
  // was opened would silently offer the wrong reminder's time.
  useEffect(() => {
    if (!visible) return;
    const parsed = parse(value);
    setHour12(parsed.hour12);
    setMinute(parsed.minute);
    setMeridiem(parsed.meridiem);
  }, [visible, value]);

  // Both wrap. Stepping past 12 back to 1 is what a clock does, and stopping
  // at the end of the range instead would make a late-evening time a long
  // press away from an early-morning one.
  //
  // FUNCTIONAL UPDATES, NOT CLOSURE READS. A held button fires these from an
  // interval whose callback was created once, at press time: reading `hour12`
  // or `minute` from the closure would compute every repeat from the value as
  // it was when the finger landed, so holding would move the clock exactly one
  // step and then appear to jam.
  const stepHour = (delta: number) =>
    setHour12((h) => ((h - 1 + delta + 12) % 12) + 1);
  const stepMinute = (delta: number) =>
    setMinute((m) => (m + delta * MINUTE_STEP + 60) % 60);

  return (
    <Dialog visible={visible} onRequestClose={onCancel}>
      <Heading>{title}</Heading>

      {/* ---- The clock ------------------------------------------------ */}
      <View style={styles.clock}>
        <Stepper
          label="Hour"
          value={String(hour12)}
          onDown={() => stepHour(-1)}
          onUp={() => stepHour(1)}
        />
        <Text style={styles.colon}>:</Text>
        <Stepper
          label="Minute"
          value={String(minute).padStart(2, '0')}
          onDown={() => stepMinute(-1)}
          onUp={() => stepMinute(1)}
        />
      </View>

      <SegmentedControl<Meridiem>
        options={[
          { value: 'am', label: 'AM' },
          { value: 'pm', label: 'PM' },
        ]}
        value={meridiem}
        onChange={setMeridiem}
        accessibilityLabel="Morning or afternoon"
      />

      {/*
        The whole answer, in one line, in the words it will appear in
        everywhere else. Three separate controls are easy to read one at a
        time and get wrong as a whole — this is the sentence being agreed to.
      */}
      <Body style={styles.preview}>
        Reminder at{' '}
        <Text style={styles.previewValue}>
          {hour12}:{String(minute).padStart(2, '0')} {meridiem}
        </Text>
        , every day.
      </Body>

      {error ? <Body style={styles.error}>{error}</Body> : null}

      <Button label="Save time" onPress={() => onConfirm(toHHMM(hour12, minute, meridiem))} />
      <Button label="Cancel" variant="ghost" onPress={onCancel} />
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

/** One − value + column, matching the threshold steppers in Settings. */
function Stepper({
  label,
  value,
  onDown,
  onUp,
}: {
  label: string;
  value: string;
  onDown: () => void;
  onUp: () => void;
}) {
  return (
    <View style={styles.stepper}>
      <StepButton glyph="minus" label={`${label} down`} onPress={onDown} />
      <Text style={styles.value} accessibilityLabel={`${label} ${value}`}>
        {value}
      </Text>
      <StepButton glyph="plus" label={`${label} up`} onPress={onUp} />
    </View>
  );
}

/**
 * A − or + that repeats while held.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * It is what pays for the minute step being one instead of five. Without it,
 * moving a reminder from 8:00 to 8:45 is forty-five taps and nobody would; with
 * it, the same move is a held thumb, and 8:47 is as reachable as 8:45.
 *
 * ── WHY onPressIn AND NOT onPress ─────────────────────────────────────
 *
 * The first step has to fire on the DOWN edge, because that is the same event
 * the hold timer starts on. Firing the single step on `onPress` (the up edge)
 * instead would double-count every hold: one step from the timer's first tick
 * and another when the finger lifted.
 *
 * `onPress` is still declared, because it is what gives the Pressable its
 * button semantics for assistive tech — a screen reader activating this control
 * synthesises a press, not a press-in. It is a no-op for touch, which has
 * already been served by onPressIn.
 */
function StepButton({
  glyph,
  label,
  onPress,
}: {
  glyph: 'minus' | 'plus';
  label: string;
  onPress: () => void;
}) {
  /** Whichever timer is pending — the initial delay, or the repeat interval. */
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  /**
   * Whether onPressIn has already served this interaction.
   *
   * Load-bearing, and not obviously so: RN fires onPressOut BEFORE onPress, so
   * by the time onPress runs the timer has already been cleared and cannot be
   * used to tell "a touch that was handled on the down edge" from "an assistive
   * activation that never had one". Without this flag every ordinary tap steps
   * twice — the minute jumps two at a time and the control feels broken.
   */
  const touchHandled = useRef(false);
  const ticks = useRef(0);

  const stop = () => {
    if (timer.current !== null) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };

  /*
   * setTimeout re-armed each tick rather than one setInterval, because the rate
   * CHANGES partway through. An interval cannot be re-timed without being torn
   * down and rebuilt, which is this same code with an extra failure mode.
   */
  const scheduleNext = () => {
    const delay = ticks.current >= HOLD_ACCELERATE_AFTER ? HOLD_FAST_MS : HOLD_INTERVAL_MS;
    timer.current = setTimeout(() => {
      ticks.current += 1;
      onPress();
      scheduleNext();
    }, delay);
  };

  const begin = () => {
    touchHandled.current = true;
    ticks.current = 0;
    onPress();
    timer.current = setTimeout(scheduleNext, HOLD_DELAY_MS);
  };

  // A press that ends anywhere — lift, drag-off, or the dialog closing under
  // it — must stop the repeat. Leaving one running would keep editing a time
  // nobody is touching any more.
  useEffect(() => stop, []);

  return (
    <Pressable
      onPressIn={begin}
      onPressOut={stop}
      onPress={() => {
        // Touch was already served on the down edge. This body only does
        // anything for an assistive-tech activation, which reaches a Pressable
        // as a bare onPress with no onPressIn before it.
        if (!touchHandled.current) onPress();
        touchHandled.current = false;
      }}
      accessibilityRole="button"
      accessibilityLabel={label}
      hitSlop={8}
      style={({ pressed }) => [styles.stepBtn, pressed && styles.pressed]}
    >
      {/*
        A text glyph, not an Icon: the icon set has no plus/minus pair, and
        adding two semantic names for one control that exists in one dialog
        would be the wrong place to grow it from.
      */}
      <Text style={styles.stepGlyph}>{glyph === 'minus' ? '−' : '+'}</Text>
    </Pressable>
  );
}

const STEP_BTN = 40;

const styles = StyleSheet.create({
  clock: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    marginTop: spacing.xs,
  },
  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  stepBtn: {
    width: STEP_BTN,
    height: STEP_BTN,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tealTint,
    minWidth: STEP_BTN,
  },
  stepGlyph: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.tealDeep,
    fontFamily: fontFamily.bold,
    // Nudged off the text baseline so − and + sit optically centred in the
    // circle; the glyphs have very different vertical extents.
    lineHeight: fontSize.lg + 4,
  },
  value: {
    minWidth: 46,
    textAlign: 'center',
    fontSize: fontSize.display,
    fontWeight: '800',
    color: colors.ink,
    fontFamily: fontFamily.extrabold,
  },
  colon: {
    fontSize: fontSize.display,
    fontWeight: '800',
    color: colors.inkSoft,
    fontFamily: fontFamily.extrabold,
    marginHorizontal: 2,
  },
  preview: { textAlign: 'center', lineHeight: 21 },
  previewValue: { fontWeight: '800', fontFamily: fontFamily.extrabold, color: colors.tealDeep },
  error: { color: colors.redDeep, textAlign: 'center' },
  pressed: { opacity: 0.6 },
});
