/**
 * "When did this happen?" — for records the app did not time itself.
 *
 * ── WHY THERE IS NO PICKER LIBRARY HERE ───────────────────────────────
 *
 * The obvious answer is @react-native-community/datetimepicker. It is a native
 * dependency, which means a rebuild, a config plugin, and a spinner UI that
 * differs on every OS version. This screen needs one date and one time, typed
 * once, by an owner who already knows when the seizure happened.
 *
 * The DATE half is now a calendar sheet (DatePickerSheet): a month grid cannot
 * offer 31 February or a day in the future, so two of the three refusals below
 * stop being errors to catch and become days that were never selectable.
 *
 * The TIME half stays as two numeric fields. There is no grid to draw for a
 * time, a wheel needs the native dependency this file exists to avoid, and two
 * separately-labelled boxes read better to a screen reader than a spinner.
 *
 * ── WHY THE TIME IS OPTIONAL ──────────────────────────────────────────
 *
 * The date is the thing an owner always knows. The clock time often is not:
 * they came home to it, or they were woken by it and never looked. Demanding
 * an hour they do not have leaves them two bad options — abandon the record,
 * or guess — and a guessed time is the worse outcome, because it enters the
 * record indistinguishable from an observed one and the cluster detector
 * reads start times.
 *
 * So a blank time is accepted and reported honestly: the instant becomes the
 * START OF THAT DAY, and `timeKnown` comes back false so the caller can stamp
 * the record `timingConfidence: 'unknown'` rather than claim midnight. Half a
 * time is still refused — an hour with no minute is a typo, not an answer.
 *
 * ── THE TWO REFUSALS ──────────────────────────────────────────────────
 *
 * A future date is rejected, not clamped. A date that does not exist (31
 * February, which Date silently rolls into March) is rejected, not corrected.
 * Both follow the rule the finalize gate already sets: on a health record, a
 * silent repair is indistinguishable from a measurement, so we refuse and ask.
 */

import { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, spacing } from '@/theme/tokens';
import { SectionRule } from '@/components/form';
import { Icon } from '@/components/Icon';
import { DatePickerSheet, formatDayKey } from '@/components/DatePickerSheet';

type Parts = { day: string; month: string; year: string; hour: string; minute: string };

const pad = (n: number) => String(n).padStart(2, '0');

/**
 * The earliest day the calendar offers, as 'YYYY-MM-DD'.
 *
 * Computed on call rather than at module load: a session left open across
 * midnight on New Year's Eve would otherwise keep last year's boundary.
 */
function TEN_YEARS_AGO_KEY(): string {
  const d = new Date();
  d.setFullYear(d.getFullYear() - 10);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function partsFrom(epochMs: number): Parts {
  const d = new Date(epochMs);
  return {
    day: pad(d.getDate()),
    month: pad(d.getMonth() + 1),
    year: String(d.getFullYear()),
    hour: pad(d.getHours()),
    minute: pad(d.getMinutes()),
  };
}

/**
 * Parses the fields into an instant, or explains why it cannot.
 *
 * Returns a message rather than throwing so the caller can render it inline —
 * an owner mid-form should never get an Alert for a typo.
 *
 * `timeKnown` is false when the time was left blank. The instant it returns is
 * then the start of that day, which is a placeholder and not a claim: the
 * caller is expected to carry the flag into the record rather than let midnight
 * pass for an observation.
 */
export function parseParts(
  parts: Parts,
  now: number,
): { epochMs: number; timeKnown: boolean } | { error: string } {
  const day = Number(parts.day);
  const month = Number(parts.month);
  const year = Number(parts.year);

  // An empty field must read as MISSING, not as zero. Number('') is 0, which is
  // finite, so a blank day would otherwise parse silently as a real number.
  if ([parts.day, parts.month, parts.year].some((raw) => raw.trim() === '')) {
    return { error: 'Pick the date this happened.' };
  }
  if ([day, month, year].some((n) => !Number.isFinite(n))) {
    return { error: 'Pick the date this happened.' };
  }
  if (parts.year.length !== 4) return { error: 'Use a four-digit year.' };
  if (month < 1 || month > 12) return { error: 'Month must be between 1 and 12.' };
  if (day < 1 || day > 31) return { error: 'Day must be between 1 and 31.' };

  // The time is optional, but only as a pair. One box filled and the other
  // empty is a half-finished entry, and guessing which half was meant ("08:__"
  // — eight o'clock? eight minutes past?) is exactly the silent repair this
  // file refuses everywhere else.
  const hourRaw = parts.hour.trim();
  const minuteRaw = parts.minute.trim();
  const timeKnown = hourRaw !== '' || minuteRaw !== '';
  if (timeKnown && (hourRaw === '' || minuteRaw === '')) {
    return { error: 'Give both the hour and the minute, or leave the time blank.' };
  }

  const hour = timeKnown ? Number(hourRaw) : 0;
  const minute = timeKnown ? Number(minuteRaw) : 0;
  if (timeKnown && [hour, minute].some((n) => !Number.isFinite(n))) {
    return { error: 'Give both the hour and the minute, or leave the time blank.' };
  }
  if (hour > 23) return { error: 'Hour must be between 0 and 23.' };
  if (minute > 59) return { error: 'Minutes must be between 0 and 59.' };

  const date = new Date(year, month - 1, day, hour, minute, 0, 0);

  // Date rolls 31 February into 3 March without complaint. Reading the parts
  // back is the only way to catch a day that never existed.
  if (
    date.getFullYear() !== year ||
    date.getMonth() !== month - 1 ||
    date.getDate() !== day
  ) {
    return { error: 'That date does not exist. Check the day and month.' };
  }

  const epochMs = date.getTime();
  if (epochMs > now) {
    return { error: 'That is in the future. A seizure cannot be logged before it happens.' };
  }
  // Ten years is not a real limit on grief or on record-keeping, but a 1970
  // date is a typo every time.
  if (epochMs < now - 10 * 365 * 24 * 60 * 60 * 1000) {
    return { error: 'That is more than ten years ago. Check the year.' };
  }

  return { epochMs, timeKnown };
}

/* ------------------------------------------------------------------ */

export function DateTimeField({
  value,
  onChange,
  label = 'When did it happen?',
}: {
  /** Epoch ms, or null while the entry is incomplete or invalid. */
  value: number | null;
  /**
   * `timeKnown` is false when the owner left the time blank — `epochMs` is
   * then the start of that day. Callers that write a health record should
   * carry it through as `timingConfidence: 'unknown'`.
   */
  onChange: (epochMs: number | null, timeKnown: boolean) => void;
  label?: string;
}) {
  // Default to today's DATE with a BLANK TIME, never to "now".
  //
  // An owner importing a clip is almost never logging something that happened
  // this minute, and a prefilled current time is the value most likely to be
  // left wrong by accident — it is valid, it is in the past, and it sails
  // through every check while being a number nobody entered. Leaving it empty
  // costs nothing now that an empty time is a real answer rather than a
  // blocked one.
  const [parts, setParts] = useState<Parts>(() =>
    value !== null
      ? partsFrom(value)
      : { ...partsFrom(Date.now()), hour: '', minute: '' },
  );
  const [touched, setTouched] = useState(false);
  const [calendarOpen, setCalendarOpen] = useState(false);

  /** The date half as a 'YYYY-MM-DD' key, for the calendar. */
  const dayKey =
    parts.year.length === 4 && parts.month && parts.day
      ? `${parts.year}-${parts.month.padStart(2, '0')}-${parts.day.padStart(2, '0')}`
      : '';

  const result = useMemo(() => parseParts(parts, Date.now()), [parts]);
  const error = 'error' in result ? result.error : null;
  const timeNotGiven = parts.hour.trim() === '' && parts.minute.trim() === '';

  // Report upward whenever the parse outcome changes. Reporting null on an
  // invalid entry is deliberate: the caller's Save button reads this value, so
  // a half-typed date can never be committed.
  useEffect(() => {
    onChange(
      'epochMs' in result ? result.epochMs : null,
      'epochMs' in result ? result.timeKnown : false,
    );
    // onChange is expected to be stable (useCallback or a setState setter).
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [result]);

  const set = (key: keyof Parts) => (text: string) => {
    setTouched(true);
    setParts((prev) => ({ ...prev, [key]: text.replace(/[^0-9]/g, '') }));
  };

  const shortcut = (daysAgo: number) => {
    const d = new Date();
    d.setDate(d.getDate() - daysAgo);
    setTouched(true);
    setParts((prev) => ({
      ...prev,
      day: pad(d.getDate()),
      month: pad(d.getMonth() + 1),
      year: String(d.getFullYear()),
    }));
  };

  const isToday = (() => {
    const d = new Date();
    return (
      parts.day === pad(d.getDate()) &&
      parts.month === pad(d.getMonth() + 1) &&
      parts.year === String(d.getFullYear())
    );
  })();

  const isYesterday = (() => {
    const d = new Date();
    d.setDate(d.getDate() - 1);
    return (
      parts.day === pad(d.getDate()) &&
      parts.month === pad(d.getMonth() + 1) &&
      parts.year === String(d.getFullYear())
    );
  })();

  return (
    <View>
      <SectionRule label={label} />

      <View style={styles.shortcuts}>
        <Shortcut label="Today" active={isToday} onPress={() => shortcut(0)} />
        <Shortcut label="Yesterday" active={isYesterday} onPress={() => shortcut(1)} />
      </View>

      <View style={styles.groups}>
        <View style={[styles.group, styles.groupWide]}>
          <Text style={styles.groupLabel}>Date</Text>
          <Pressable
            onPress={() => setCalendarOpen(true)}
            accessibilityRole="button"
            accessibilityLabel={
              dayKey ? `Date, ${formatDayKey(dayKey)}` : 'Pick a date'
            }
            accessibilityHint="Opens a calendar"
            style={({ pressed }) => [styles.dateBtn, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.dateBtnText} numberOfLines={1}>
              {dayKey ? formatDayKey(dayKey) : 'Pick a date'}
            </Text>
            <Icon name="calendar" size="md" color={colors.tealDeep} />
          </Pressable>
        </View>

        <View style={styles.group}>
          <Text style={styles.groupLabel}>Time (optional)</Text>
          <View style={styles.fieldRow}>
            <Segment
              value={parts.hour}
              onChangeText={set('hour')}
              placeholder="HH"
              maxLength={2}
              accessibilityLabel="Hour, 24-hour clock, optional"
            />
            <Text style={styles.separator}>:</Text>
            <Segment
              value={parts.minute}
              onChangeText={set('minute')}
              placeholder="MM"
              maxLength={2}
              accessibilityLabel="Minute, optional"
            />
            {(parts.hour !== '' || parts.minute !== '') && (
              // A typed time has to be removable, or "optional" only holds
              // until the owner touches the box: clearing two fields by
              // backspace is fiddly on a number pad and easy to leave half
              // done, which is the one shape parseParts refuses.
              <Pressable
                onPress={() => {
                  setTouched(true);
                  setParts((prev) => ({ ...prev, hour: '', minute: '' }));
                }}
                accessibilityRole="button"
                accessibilityLabel="Clear the time"
                hitSlop={8}
                style={({ pressed }) => [styles.clearTime, pressed && { opacity: 0.6 }]}
              >
                <Icon name="clear" size="sm" color={colors.inkSoft} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      <DatePickerSheet
        visible={calendarOpen}
        title={label}
        value={dayKey}
        // The calendar must not offer a day parseParts will then refuse. Ten
        // years matches the rule below, so the year list stops where the
        // validator does instead of leading the owner into a dead end.
        minDate={TEN_YEARS_AGO_KEY()}
        onPick={(day) => {
          const [y, m, d] = day.split('-');
          setTouched(true);
          setParts((prev) => ({ ...prev, year: y ?? '', month: m ?? '', day: d ?? '' }));
          setCalendarOpen(false);
        }}
        onClose={() => setCalendarOpen(false)}
      />

      {touched && error ? (
        <Text style={styles.error} accessibilityLiveRegion="polite">
          {error}
        </Text>
      ) : timeNotGiven ? (
        // Said plainly, because leaving it blank changes what is stored. The
        // owner should not discover in the vet report that a time they never
        // gave is sitting in the record.
        <Text style={styles.help}>
          No time needed — leave it blank if you don&rsquo;t know. The record is
          filed under this date and marked as an unknown time.
        </Text>
      ) : (
        <Text style={styles.help}>
          Use a 24-hour clock, or leave the time blank if you don&rsquo;t know
          it. An approximate time is fine — it is recorded as your estimate,
          not as a measurement.
        </Text>
      )}
    </View>
  );
}

function Shortcut({
  label,
  active,
  onPress,
}: {
  label: string;
  active: boolean;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.shortcut,
        active && styles.shortcutOn,
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.shortcutLabel, active && styles.shortcutLabelOn]}>
        {label}
      </Text>
    </Pressable>
  );
}

function Segment({
  value,
  onChangeText,
  placeholder,
  maxLength,
  accessibilityLabel,
  wide = false,
}: {
  value: string;
  onChangeText: (text: string) => void;
  placeholder: string;
  maxLength: number;
  accessibilityLabel: string;
  wide?: boolean;
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={colors.inkSoft}
      keyboardType="number-pad"
      maxLength={maxLength}
      accessibilityLabel={accessibilityLabel}
      style={[styles.segment, wide && styles.segmentWide]}
    />
  );
}

const styles = StyleSheet.create({
  shortcuts: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.md },
  shortcut: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  shortcutOn: { backgroundColor: colors.tealTint, borderColor: colors.teal },
  shortcutLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.ink, fontFamily: fontFamily.semibold },
  shortcutLabelOn: { color: colors.tealDeep, fontWeight: '800', fontFamily: fontFamily.extrabold },

  groups: { flexDirection: 'row', gap: spacing.lg, flexWrap: 'wrap' },
  group: { gap: spacing.sm },
  groupWide: { flex: 1, minWidth: 180 },
  groupLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.9,
    textTransform: 'uppercase',
    color: colors.inkSoft,
    fontFamily: fontFamily.bold
  },
  fieldRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  clearTime: {
    width: MIN_TOUCH_TARGET,
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dateBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.control,
    backgroundColor: colors.card,
  },
  dateBtnText: { fontSize: fontSize.base, fontWeight: '700', color: colors.ink, fontFamily: fontFamily.bold },
  segment: {
    width: 54,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.control,
    backgroundColor: colors.card,
    textAlign: 'center',
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
    fontFamily: fontFamily.bold
  },
  segmentWide: { width: 76 },
  separator: {
    fontSize: fontSize.md,
    color: colors.inkSoft,
    fontWeight: '700',
    paddingHorizontal: 2,
    fontFamily: fontFamily.bold
  },

  error: {
    marginTop: spacing.md,
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.redDeep,
    lineHeight: fontSize.sm * 1.45,
    fontFamily: fontFamily.semibold
  },
  help: {
    marginTop: spacing.md,
    fontSize: fontSize.sm,
    color: colors.inkSoft,
    lineHeight: fontSize.sm * 1.45,
    fontFamily: fontFamily.regular
  },
});
