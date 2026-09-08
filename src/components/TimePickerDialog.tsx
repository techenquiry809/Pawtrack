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

import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Heading, SegmentedControl } from '@/components/ui';
import { Dialog } from '@/components/Dialog';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';

/**
 * Minutes move in fives.
 *
 * A dose is not a thing anyone schedules to the minute, and 60 single steps to
 * cross an hour is a control nobody finishes using. Five covers every time a
 * prescription is actually written at.
 */
const MINUTE_STEP = 5;

type Meridiem = 'am' | 'pm';

/** '13:30' → { hour12: 1, minute: 30, meridiem: 'pm' } */
function parse(timeHHMM: string): { hour12: number; minute: number; meridiem: Meridiem } {
  const [h, m] = timeHHMM.split(':').map(Number);
  const hour = Number.isInteger(h) && h! >= 0 && h! <= 23 ? h! : 8;
  const minute = Number.isInteger(m) && m! >= 0 && m! <= 59 ? m! : 0;
  return {
    hour12: hour % 12 === 0 ? 12 : hour % 12,
    // Snapped to the step, so opening the picker on a legacy 07:07 reminder
    // does not show a value the − and + buttons can never return to.
    minute: Math.round(minute / MINUTE_STEP) * MINUTE_STEP % 60,
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
  const stepHour = (delta: number) => setHour12(((hour12 - 1 + delta + 12) % 12) + 1);
  const stepMinute = (delta: number) =>
    setMinute((minute + delta * MINUTE_STEP + 60) % 60);

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

function StepButton({
  glyph,
  label,
  onPress,
}: {
  glyph: 'minus' | 'plus';
  label: string;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
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
