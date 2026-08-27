/**
 * A calendar for picking ONE date.
 *
 * ── WHY THIS EXISTS RATHER THAN A PICKER LIBRARY ──────────────────────
 *
 * @react-native-community/datetimepicker is a native dependency: a rebuild, a
 * config plugin, and a spinner whose behaviour differs on every OS version.
 * This app needs one date, chosen occasionally, in three places. A month grid
 * costs no native code and behaves identically everywhere.
 *
 * It is deliberately separate from CheckinCalendar, which looks similar and is
 * a different thing: that one BROWSES a history and colours every day by
 * whether it was logged. This one SELECTS, knows nothing about records, and is
 * reused by the dog profile and the video import.
 *
 * ── THREE LEVELS, BECAUSE PAGING IS NOT NAVIGATION ────────────────────
 *
 * The month arrows alone made a date of birth a sixty-tap job: a dog born in
 * 2021 is 60-odd presses of ‹ from this year, and nothing on screen said there
 * was another way. Tapping the month label now zooms OUT to years, then months,
 * then back to days — so any date in the allowed range is three taps away.
 *
 * Years are listed NEWEST FIRST. Every date this picker collects is in the
 * past and most are recent — a dog's birth year, the first seizure, the day a
 * clip was filmed — so the likely answers belong at the top where they are
 * seen without scrolling.
 *
 * ── RANGE IS ENFORCED, NOT SUGGESTED ──────────────────────────────────
 *
 * Out-of-range days render disabled and cannot be tapped, and the month arrows
 * stop at the boundary. A date of birth in the future is not a formatting
 * problem to correct afterwards — it is a value the calendar should never have
 * offered.
 */

import { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, fontSize, radius, spacing, MIN_TOUCH_TARGET } from '@/theme/tokens';
import { localDayKey } from '@/utils/time';

/** Monday-first: the app's users think in weeks that start on Monday. */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

function keyFor(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/** 'YYYY-MM-DD' → parts, or null when it is not a real date. */
export function parseDayKey(key: string): { y: number; m: number; d: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key.trim());
  if (!match) return null;
  const y = Number(match[1]);
  const m = Number(match[2]) - 1;
  const d = Number(match[3]);
  const date = new Date(y, m, d);
  // Reading the parts back is the only way to catch 31 February, which Date
  // rolls into March without complaint.
  if (date.getFullYear() !== y || date.getMonth() !== m || date.getDate() !== d) {
    return null;
  }
  return { y, m, d };
}

/** 'YYYY-MM-DD' → 'Mon 3 March 2026'. Returns '' for anything unparseable. */
export function formatDayKey(key: string): string {
  const parts = parseDayKey(key);
  if (!parts) return '';
  return new Date(parts.y, parts.m, parts.d).toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

export function DatePickerSheet({
  visible,
  onClose,
  onPick,
  onClear,
  value,
  title,
  /** Earliest selectable day, inclusive. 'YYYY-MM-DD'. */
  minDate,
  /** Latest selectable day, inclusive. Defaults to today — see the note above. */
  maxDate,
}: {
  visible: boolean;
  onClose: () => void;
  onPick: (dayKey: string) => void;
  /** Omit to hide the Clear action, for a field that must hold a value. */
  onClear?: () => void;
  value: string;
  title: string;
  minDate?: string;
  maxDate?: string;
}) {
  const todayKey = localDayKey();
  const max = maxDate ?? todayKey;

  // Open on the month of the current value, or on today when there is none.
  const initial = useMemo(() => {
    const parsed = parseDayKey(value);
    if (parsed) return { year: parsed.y, month: parsed.m };
    const t = parseDayKey(max) ?? parseDayKey(todayKey);
    const now = new Date();
    return { year: t?.y ?? now.getFullYear(), month: t?.m ?? now.getMonth() };
  }, [value, max, todayKey]);

  const [year, setYear] = useState(initial.year);
  const [month, setMonth] = useState(initial.month);
  /** Which level the grid is showing. Always reopens on days. */
  const [mode, setMode] = useState<'days' | 'months' | 'years'>('days');

  // Reopening on a different value must not leave the grid on the last month
  // the owner happened to be browsing, or zoomed out to the year list.
  useEffect(() => {
    if (visible) {
      setYear(initial.year);
      setMonth(initial.month);
      setMode('days');
    }
  }, [visible, initial.year, initial.month]);

  const cells = useMemo(() => {
    const first = new Date(year, month, 1);
    // getDay() is Sunday-first; shift so Monday is 0.
    const lead = (first.getDay() + 6) % 7;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    const out: { key: string; day: number | null }[] = [];
    for (let i = 0; i < lead; i += 1) out.push({ key: `blank_${i}`, day: null });
    for (let d = 1; d <= daysInMonth; d += 1) {
      out.push({ key: keyFor(year, month, d), day: d });
    }
    return out;
  }, [year, month]);

  const shift = (delta: number) => {
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  // Page limits: the first of this month against the range ends.
  const monthStart = keyFor(year, month, 1);
  const monthEnd = keyFor(year, month, new Date(year, month + 1, 0).getDate());
  const canGoBack = minDate === undefined || monthStart > minDate;
  const canGoForward = monthEnd < max;

  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  const maxParts = parseDayKey(max);
  const minParts = minDate ? parseDayKey(minDate) : null;
  const maxYear = maxParts?.y ?? new Date().getFullYear();
  const minYear = minParts?.y ?? maxYear - YEAR_SPAN;

  /** Newest first — see the note at the top of this file. */
  const years = useMemo(() => {
    const out: number[] = [];
    for (let y = maxYear; y >= minYear; y -= 1) out.push(y);
    return out;
  }, [maxYear, minYear]);

  /** A month is reachable when any day in it falls inside the range. */
  const monthInRange = (y: number, m: number) => {
    const start = keyFor(y, m, 1);
    const end = keyFor(y, m, new Date(y, m + 1, 0).getDate());
    if (end < (minDate ?? '')) return false;
    return start <= max;
  };

  const monthNames = useMemo(
    () =>
      Array.from({ length: 12 }, (_, m) =>
        new Date(2000, m, 1).toLocaleDateString(undefined, { month: 'short' }),
      ),
    [],
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Tapping the scrim dismisses without choosing — the same escape a
          sheet gives everywhere else in the OS. */}
      <Pressable style={styles.scrim} onPress={onClose} accessibilityLabel="Close">
        {/* Swallows taps so a press inside the sheet does not dismiss it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.headerRow}>
            <Text style={styles.title}>{title}</Text>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={({ pressed }) => [styles.iconBtn, pressed && styles.pressed]}
            >
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <View style={styles.monthRow}>
            <Pressable
              onPress={() => shift(-1)}
              disabled={!canGoBack || mode !== 'days'}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              accessibilityState={{ disabled: !canGoBack || mode !== 'days' }}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && styles.pressed,
                (!canGoBack || mode !== 'days') && styles.hidden,
              ]}
            >
              <View style={styles.flip}>
                <Icon name="chevron" size="md" color={colors.ink} />
              </View>
            </Pressable>

            {/* The label IS the zoom control. Paging month by month was the
                only way out of this sheet, and it is a sixty-tap way out. */}
            <Pressable
              onPress={() =>
                setMode((m) => (m === 'days' ? 'years' : m === 'months' ? 'years' : 'days'))
              }
              accessibilityRole="button"
              accessibilityLabel={
                mode === 'days'
                  ? `${monthLabel}. Choose a different year`
                  : 'Back to the day grid'
              }
              hitSlop={8}
              style={({ pressed }) => [styles.monthBtn, pressed && styles.pressed]}
            >
              <Text style={styles.monthLabel}>
                {mode === 'days' ? monthLabel : mode === 'months' ? String(year) : 'Pick a year'}
              </Text>
              {/* Chevron rotated to point down/up, so the label reads as a
                  control rather than as a caption between two arrows. */}
              <View style={mode === 'days' ? styles.chevDown : styles.chevUp}>
                <Icon name="chevron" size="sm" color={colors.tealDeep} />
              </View>
            </Pressable>

            <Pressable
              onPress={() => shift(1)}
              disabled={!canGoForward || mode !== 'days'}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              accessibilityState={{ disabled: !canGoForward || mode !== 'days' }}
              style={({ pressed }) => [
                styles.iconBtn,
                pressed && styles.pressed,
                (!canGoForward || mode !== 'days') && styles.hidden,
              ]}
            >
              <Icon name="chevron" size="md" color={colors.ink} />
            </Pressable>
          </View>

          {mode === 'years' ? (
            <ScrollView style={styles.zoomScroll} showsVerticalScrollIndicator={false}>
              <View style={styles.zoomGrid}>
                {years.map((y) => (
                  <Pressable
                    key={y}
                    onPress={() => {
                      setYear(y);
                      setMode('months');
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={String(y)}
                    accessibilityState={{ selected: y === year }}
                    style={styles.zoomCell}
                  >
                    <View style={[styles.zoomPill, y === year && styles.zoomPillOn]}>
                      <Text style={[styles.zoomText, y === year && styles.zoomTextOn]}>
                        {y}
                      </Text>
                    </View>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
          ) : mode === 'months' ? (
            <View style={styles.zoomGrid}>
              {monthNames.map((name, m) => {
                const usable = monthInRange(year, m);
                return (
                  <Pressable
                    key={name}
                    onPress={() => {
                      setMonth(m);
                      setMode('days');
                    }}
                    disabled={!usable}
                    accessibilityRole="button"
                    accessibilityLabel={name}
                    accessibilityState={{ selected: m === month, disabled: !usable }}
                    style={styles.zoomCell}
                  >
                    <View style={[styles.zoomPill, m === month && styles.zoomPillOn]}>
                      <Text
                        style={[
                          styles.zoomText,
                          !usable && styles.zoomTextOut,
                          m === month && styles.zoomTextOn,
                        ]}
                      >
                        {name}
                      </Text>
                    </View>
                  </Pressable>
                );
              })}
            </View>
          ) : (
            <>
              <View style={styles.weekRow}>
                {WEEKDAYS.map((d, i) => (
                  <Text key={`${d}${i}`} style={styles.weekday}>
                    {d}
                  </Text>
                ))}
              </View>

              <View style={styles.grid}>
                {cells.map((cell) => {
                  if (cell.day === null) {
                    return <View key={cell.key} style={styles.cell} />;
                  }
                  const outOfRange =
                    cell.key > max || (minDate !== undefined && cell.key < minDate);
                  const selected = cell.key === value;
                  const isToday = cell.key === todayKey;

                  return (
                    <Pressable
                      key={cell.key}
                      onPress={() => onPick(cell.key)}
                      disabled={outOfRange}
                      accessibilityRole="button"
                      accessibilityLabel={formatDayKey(cell.key)}
                      accessibilityState={{ selected, disabled: outOfRange }}
                      style={styles.cell}
                    >
                      <View
                        style={[
                          styles.dayDot,
                          isToday && !selected && styles.dayToday,
                          selected && styles.daySelected,
                        ]}
                      >
                        <Text
                          style={[
                            styles.dayText,
                            outOfRange && styles.dayTextOut,
                            selected && styles.dayTextSelected,
                          ]}
                        >
                          {cell.day}
                        </Text>
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </>
          )}

          <View style={styles.actions}>
            {onClear ? (
              <Pressable
                onPress={onClear}
                accessibilityRole="button"
                accessibilityLabel="Clear date"
                style={({ pressed }) => [styles.action, pressed && styles.pressed]}
              >
                <Text style={styles.actionText}>Clear</Text>
              </Pressable>
            ) : (
              <View style={styles.flex} />
            )}
            <Pressable
              onPress={() => onPick(todayKey)}
              disabled={todayKey > max || (minDate !== undefined && todayKey < minDate)}
              accessibilityRole="button"
              accessibilityLabel="Select today"
              style={({ pressed }) => [
                styles.action,
                styles.actionPrimary,
                pressed && styles.pressed,
              ]}
            >
              <Text style={[styles.actionText, styles.actionTextPrimary]}>Today</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const DAY = 40;

/** How far back the year list reaches when no explicit minimum is given. */
const YEAR_SPAN = 30;

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.7 },
  disabled: { opacity: 0.3 },

  scrim: {
    flex: 1,
    backgroundColor: colors.scrim,
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radius.lg,
    padding: spacing.lg,
  },

  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  title: { flex: 1, fontSize: fontSize.md, fontWeight: '800', color: colors.ink },
  close: { fontSize: fontSize.md, fontWeight: '700', color: colors.ink },

  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginTop: spacing.sm,
  },
  monthLabel: { fontSize: fontSize.md, fontWeight: '800', color: colors.ink },
  monthBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.sm,
  },
  chevDown: { transform: [{ rotate: '90deg' }] },
  chevUp: { transform: [{ rotate: '-90deg' }] },
  // Arrows keep their space when they do not apply, so the label does not jump
  // sideways as the sheet changes level.
  hidden: { opacity: 0 },

  zoomScroll: { maxHeight: 260 },
  zoomGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.sm,
  },
  zoomCell: {
    width: '25%',
    paddingVertical: 4,
    paddingHorizontal: 3,
  },
  zoomPill: {
    minHeight: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.pill,
    backgroundColor: colors.bg,
  },
  zoomPillOn: { backgroundColor: colors.teal },
  zoomText: { fontSize: fontSize.base, fontWeight: '700', color: colors.ink },
  zoomTextOut: { color: colors.inkSoft, opacity: 0.4, fontWeight: '500' },
  zoomTextOn: { color: colors.onMedia, fontWeight: '800' },
  // The icon set has one chevron; the back arrow is it, mirrored.
  flip: { transform: [{ scaleX: -1 }] },
  iconBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: MIN_TOUCH_TARGET / 2,
  },

  weekRow: { flexDirection: 'row', marginTop: spacing.sm },
  weekday: {
    width: `${100 / 7}%`,
    textAlign: 'center',
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.inkSoft,
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.xs },
  cell: {
    width: `${100 / 7}%`,
    height: DAY + 6,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayDot: {
    width: DAY,
    height: DAY,
    borderRadius: DAY / 2,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayToday: { borderWidth: 1.5, borderColor: colors.teal },
  daySelected: { backgroundColor: colors.teal },
  dayText: { fontSize: fontSize.base, fontWeight: '700', color: colors.ink },
  dayTextOut: { color: colors.inkSoft, opacity: 0.4, fontWeight: '500' },
  dayTextSelected: { color: colors.onMedia, fontWeight: '800' },

  actions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginTop: spacing.md,
  },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingHorizontal: spacing.lg,
    borderRadius: radius.pill,
  },
  actionPrimary: { backgroundColor: colors.tealTint },
  actionText: { fontSize: fontSize.base, fontWeight: '800', color: colors.inkSoft },
  actionTextPrimary: { color: colors.tealDeep },
});
