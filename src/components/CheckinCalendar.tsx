/**
 * A month calendar showing which days have a check-in, and a way to fill in
 * the ones that were missed.
 *
 * ── WHY A CALENDAR AT ALL ─────────────────────────────────────────────
 *
 * Check-ins are the control dataset: without ordinary days, every "pattern"
 * the analysis finds is measured against nothing. A list of check-ins tells
 * you what you did record; only a calendar shows you the GAPS, which is the
 * thing that actually needs acting on.
 *
 * ── WHAT IT WILL NOT DO ───────────────────────────────────────────────
 *
 * Future days are inert. A check-in about tomorrow is not a record of
 * anything, and the repository refuses one anyway — this just makes that
 * obvious before the tap rather than after.
 *
 * ── TAPPING A DAY ─────────────────────────────────────────────────────
 *
 * A RECORDED day opens a summary of what was actually logged, in place. The
 * owner's question there is "what did I say about Tuesday?", and answering it
 * by dumping them into an edit form makes them reconstruct the answer from
 * form controls — and risks them changing a value by accident on the way.
 *
 * A MISSED day has nothing to show, so it goes straight to filling it in.
 *
 * ── HONESTY ───────────────────────────────────────────────────────────
 *
 * A day filled in later is marked with a ring rather than a solid dot, and the
 * saved row carries `backfilled`. This is the same distinction seizures make
 * with `retrospective`: remembering last Tuesday is weaker evidence than
 * writing it down that Tuesday, and the analysis is entitled to know.
 */

import { useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Body, Button, Heading, Muted, Pill } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, spacing } from '@/theme/tokens';
import { formatFullDate, localDayKey } from '@/utils/time';
import type { DailyCheckin } from '@/types/domain';

/** Monday-first: the app's users think in weeks that start on Monday. */
const WEEKDAYS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

export type DayStatus = 'done' | 'backfilled' | 'missed' | 'future' | 'blank';

function keyFor(year: number, month: number, day: number): string {
  return `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}

/**
 * Builds the grid for a month: leading blanks so the 1st lands on its real
 * weekday, then every day with its status.
 */
export function buildMonthGrid(
  year: number,
  month: number,
  records: Map<string, DailyCheckin>,
  todayKey: string,
  videoDays: Set<string>,
): { key: string; day: number | null; status: DayStatus; hasVideo: boolean }[] {
  const first = new Date(year, month, 1);
  // getDay() is Sunday-first; shift so Monday is 0.
  const lead = (first.getDay() + 6) % 7;
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const cells: {
    key: string; day: number | null; status: DayStatus; hasVideo: boolean;
  }[] = [];
  for (let i = 0; i < lead; i += 1) {
    cells.push({ key: `blank_${i}`, day: null, status: 'blank', hasVideo: false });
  }
  for (let d = 1; d <= daysInMonth; d += 1) {
    const key = keyFor(year, month, d);
    const record = records.get(key);
    let status: DayStatus;
    if (key > todayKey) status = 'future';
    else if (record?.backfilled) status = 'backfilled';
    else if (record) status = 'done';
    else status = 'missed';
    cells.push({ key, day: d, status, hasVideo: videoDays.has(key) });
  }
  return cells;
}

/** Stable identity, so an omitted prop does not re-run the grid memo. */
const EMPTY_DAYS: Set<string> = new Set();

export function CheckinCalendar({
  visible,
  onClose,
  onPickDate,
  records,
  videoDays,
  dogName,
}: {
  visible: boolean;
  onClose: () => void;
  onPickDate: (dayKey: string) => void;
  /** Every check-in, keyed by its local day. */
  records: Map<string, DailyCheckin>;
  /**
   * Local days that have at least one seizure video.
   *
   * Kept separate from `records` rather than folded into the check-in status,
   * because they answer different questions. The day mark says whether the
   * OWNER wrote anything down; the video dot says whether there is FOOTAGE.
   * A day can easily have one and not the other — a seizure filmed at 3am on a
   * day nobody got round to a check-in is exactly the day a vet asks about.
   */
  videoDays?: Set<string>;
  dogName: string;
}) {
  const todayKey = localDayKey();
  const now = new Date();
  const [year, setYear] = useState(now.getFullYear());
  const [month, setMonth] = useState(now.getMonth());

  const [selected, setSelected] = useState<string | null>(null);

  const videoSet = videoDays ?? EMPTY_DAYS;
  const cells = useMemo(
    () => buildMonthGrid(year, month, records, todayKey, videoSet),
    [year, month, records, todayKey, videoSet],
  );

  const selectedRecord = selected ? records.get(selected) : undefined;

  const recorded = cells.filter(
    (c) => c.status === 'done' || c.status === 'backfilled',
  ).length;
  const missed = cells.filter((c) => c.status === 'missed').length;

  const shift = (delta: number) => {
    setSelected(null);
    const next = new Date(year, month + delta, 1);
    setYear(next.getFullYear());
    setMonth(next.getMonth());
  };

  // Never page past the current month — there is nothing there to record.
  const atCurrentMonth = year === now.getFullYear() && month === now.getMonth();

  const monthLabel = new Date(year, month, 1).toLocaleDateString(undefined, {
    month: 'long',
    year: 'numeric',
  });

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <View style={styles.scrim}>
        <View style={styles.sheet}>
          <View style={styles.headerRow}>
            <Heading>Check-in history</Heading>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              accessibilityLabel="Close"
              hitSlop={10}
              style={({ pressed }) => pressed && styles.pressed}
            >
              <Text style={styles.close}>✕</Text>
            </Pressable>
          </View>

          <Muted style={styles.intro}>
            Tap a recorded day to see what you logged, or a missed day to fill
            it in for {dogName}.
          </Muted>

          {/* --- Month switcher ------------------------------------- */}
          <View style={styles.monthRow}>
            <Pressable
              onPress={() => shift(-1)}
              accessibilityRole="button"
              accessibilityLabel="Previous month"
              hitSlop={10}
              style={({ pressed }) => [styles.monthBtn, pressed && styles.pressed]}
            >
              <Text style={styles.monthArrow}>‹</Text>
            </Pressable>
            <Text style={styles.monthLabel}>{monthLabel}</Text>
            <Pressable
              onPress={() => shift(1)}
              disabled={atCurrentMonth}
              accessibilityRole="button"
              accessibilityLabel="Next month"
              accessibilityState={{ disabled: atCurrentMonth }}
              hitSlop={10}
              style={({ pressed }) => [
                styles.monthBtn,
                pressed && styles.pressed,
                atCurrentMonth && styles.disabled,
              ]}
            >
              <Text style={styles.monthArrow}>›</Text>
            </Pressable>
          </View>

          {/* --- Weekday header ------------------------------------- */}
          <View style={styles.weekRow}>
            {WEEKDAYS.map((w, i) => (
              <Text key={`${w}${i}`} style={styles.weekday}>
                {w}
              </Text>
            ))}
          </View>

          {/* --- Grid ----------------------------------------------- */}
          <View style={styles.grid}>
            {cells.map((cell) =>
              cell.day === null ? (
                <View key={cell.key} style={styles.cell} />
              ) : (
                <DayCell
                  key={cell.key}
                  day={cell.day}
                  status={cell.status}
                  hasVideo={cell.hasVideo}
                  isToday={cell.key === todayKey}
                  isSelected={cell.key === selected}
                  onPress={() => {
                    // Recorded → show what was logged. Missed → go fill it in.
                    if (cell.status === 'done' || cell.status === 'backfilled') {
                      setSelected(cell.key === selected ? null : cell.key);
                    } else {
                      onPickDate(cell.key);
                    }
                  }}
                />
              ),
            )}
          </View>

          {selected && selectedRecord && (
            <DaySummary
              dayKey={selected}
              record={selectedRecord}
              onEdit={() => onPickDate(selected)}
            />
          )}

          {/* --- Legend. Shape as well as colour, never colour alone. */}
          <View style={styles.legend}>
            <LegendItem status="done" label="Recorded" />
            <LegendItem status="backfilled" label="Filled in later" />
            <LegendItem status="missed" label="Missed" />
            {/* Only shown when there is footage to find, so the legend does
                not explain a marker the owner will never see. */}
            {videoSet.size > 0 && <LegendItem status="video" label="Has video" />}
          </View>

          <Body style={styles.summary}>
            {recorded} recorded
            {missed > 0 ? ` · ${missed} still open` : ' · nothing missed'} this month.
          </Body>

          <Button label="Done" variant="ghost" onPress={onClose} style={styles.doneBtn} />
        </View>
      </View>
    </Modal>
  );
}

function DayCell({
  day,
  status,
  hasVideo,
  isToday,
  isSelected,
  onPress,
}: {
  day: number;
  status: DayStatus;
  hasVideo: boolean;
  isToday: boolean;
  isSelected: boolean;
  onPress: () => void;
}) {
  const inert = status === 'future';
  const label =
    status === 'done'
      ? 'recorded, tap to see what was logged'
      : status === 'backfilled'
        ? 'filled in later, tap to see what was logged'
        : status === 'missed'
          ? 'missed, tap to fill in'
          : 'in the future';

  return (
    <Pressable
      onPress={onPress}
      disabled={inert}
      accessibilityRole="button"
      accessibilityLabel={`${day}, ${label}${hasVideo ? ', has a seizure video' : ''}`}
      accessibilityState={{ disabled: inert }}
      style={({ pressed }) => [styles.cell, pressed && !inert && styles.pressed]}
    >
      <View
        style={[
          styles.dayMark,
          isSelected && styles.daySelected,
          status === 'done' && styles.dayDone,
          status === 'backfilled' && styles.dayBackfilled,
          status === 'missed' && styles.dayMissed,
          isToday && styles.dayToday,
        ]}
      >
        <Text
          style={[
            styles.dayText,
            status === 'done' && styles.dayTextOn,
            inert && styles.dayTextInert,
          ]}
        >
          {day}
        </Text>
      </View>
      {/*
        Both markers share one row so they cannot collide. A day can be a
        missed check-in AND hold footage, and that combination is the one worth
        seeing: something happened, and nobody wrote the day up.
      */}
      <View style={styles.markers}>
        {status === 'missed' && <View style={styles.missedDot} />}
        {hasVideo && <View style={styles.videoDot} />}
      </View>
    </Pressable>
  );
}

/**
 * What was actually logged on one day.
 *
 * Reads out every answer the form collects, including the ones left at their
 * default — "Appetite: normal" is a real observation, and hiding defaults
 * would make a fully-completed day look half-empty.
 *
 * Sleep is the one field that can genuinely be absent, so it says "not
 * recorded" rather than inventing a zero.
 *
 * ── EXCEPT ON A mood_only DAY ─────────────────────────────────────────
 *
 * The paragraph above holds only when the owner actually opened the form. A
 * row created by tapping a face on Home carries schema defaults for everything
 * except energy, and printing "Appetite: Normal" there would report a default
 * back as an observation — the owner would read their own answer where they
 * had given none, and could repeat it to a vet.
 *
 * So those days show the mood and say plainly that nothing else was recorded,
 * with the form one tap away.
 */
function DaySummary({
  dayKey,
  record,
  onEdit,
}: {
  dayKey: string;
  record: DailyCheckin;
  onEdit: () => void;
}) {
  const date = new Date(`${dayKey}T12:00:00`);
  const gi =
    record.gi === 'none'
      ? 'None'
      : record.gi === 'both'
        ? 'Vomiting and diarrhea'
        : record.gi === 'vomit'
          ? 'Vomiting'
          : 'Diarrhea';

  return (
    <View style={styles.summaryPanel}>
      <View style={styles.summaryHead}>
        <Text style={styles.summaryDate}>
          {formatFullDate(date.getTime())}
        </Text>
        {record.backfilled && <Pill label="Filled in later" tone="teal" />}
      </View>

      {record.moodOnly ? (
        <>
          <View style={styles.summaryGrid}>
            <SummaryFact label="Energy" value={`${record.energy} / 5`} />
          </View>
          <SummaryFact
            label="The rest of this day"
            value="Not recorded — only the mood was set"
            wide
          />
        </>
      ) : (
        <>
          <View style={styles.summaryGrid}>
            <SummaryFact
              label="Sleep"
              value={record.sleepHrs === null ? 'Not recorded' : `${record.sleepHrs} h`}
            />
            <SummaryFact label="Appetite" value={sentence(record.appetite)} />
            <SummaryFact label="Water" value={sentence(record.water)} />
            <SummaryFact label="Energy" value={`${record.energy} / 5`} />
            <SummaryFact label="Stress" value={`${record.stress} / 5`} />
            <SummaryFact
              label="Medication"
              value={record.medOnTime ? 'On time' : 'Not on time'}
            />
          </View>

          <SummaryFact label="Vomiting or diarrhea" value={gi} wide />
        </>
      )}

      {record.unusual.trim().length > 0 && (
        <View style={styles.summaryNote}>
          <Text style={styles.summaryLabel}>ANYTHING UNUSUAL</Text>
          <Body style={{ marginTop: 2 }}>{record.unusual}</Body>
        </View>
      )}

      <Pressable
        onPress={onEdit}
        accessibilityRole="button"
        accessibilityLabel={`Edit the check-in for ${date.toLocaleDateString()}`}
        style={({ pressed }) => [styles.editRow, pressed && styles.pressed]}
      >
        <Muted style={styles.editLabel}>Edit this day</Muted>
        <Icon name="chevron" size="md" color={colors.tealDeep} />
      </Pressable>
    </View>
  );
}

/** First letter up, rest untouched — 'decreased' → 'Decreased'. */
function sentence(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function SummaryFact({
  label,
  value,
  wide = false,
}: {
  label: string;
  value: string;
  wide?: boolean;
}) {
  return (
    <View
      style={[styles.summaryFact, wide && styles.summaryFactWide]}
      accessible
      accessibilityLabel={`${label}: ${value}`}
    >
      <Text style={styles.summaryLabel}>{label.toUpperCase()}</Text>
      <Text style={styles.summaryValue}>{value}</Text>
    </View>
  );
}

function LegendItem({
  status, label,
}: { status: DayStatus | 'video'; label: string }) {
  return (
    <View style={styles.legendItem}>
      <View
        style={[
          styles.legendSwatch,
          status === 'done' && styles.dayDone,
          status === 'backfilled' && styles.dayBackfilled,
          status === 'missed' && styles.dayMissed,
          // The dot is drawn at its real size inside the swatch box, so the
          // legend shows the marker the calendar actually draws.
          status === 'video' && styles.legendVideo,
        ]}
      />
      <Muted style={styles.legendLabel}>{label}</Muted>
    </View>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(32,41,58,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    backgroundColor: colors.card,
    borderRadius: radius.sheet,
    padding: spacing.lg,
  },
  headerRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  close: { fontSize: 18, color: colors.inkSoft, paddingHorizontal: 4, fontFamily: fontFamily.regular },
  intro: { marginTop: 4, marginBottom: spacing.md },
  pressed: { opacity: 0.65 },
  disabled: { opacity: 0.3 },

  monthRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: spacing.sm,
  },
  monthBtn: {
    width: 36,
    height: 36,
    alignItems: 'center',
    justifyContent: 'center',
    borderRadius: radius.control,
  },
  monthArrow: { fontSize: 24, color: colors.ink, lineHeight: 28, fontFamily: fontFamily.regular },
  monthLabel: { fontSize: fontSize.md, fontWeight: '700', color: colors.ink, fontFamily: fontFamily.bold },

  weekRow: { flexDirection: 'row' },
  weekday: {
    flex: 1,
    textAlign: 'center',
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.inkSoft,
    marginBottom: 4,
    fontFamily: fontFamily.bold
  },

  grid: { flexDirection: 'row', flexWrap: 'wrap' },
  cell: {
    width: `${100 / 7}%`,
    height: 42,
    alignItems: 'center',
    justifyContent: 'center',
  },
  dayMark: {
    width: 32,
    height: 32,
    // A CIRCLE: half of 32. Not a step on the radius scale — snapping
    // this to a token turns the circle into a rounded square.
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  dayDone: { backgroundColor: colors.teal, borderColor: colors.teal },
  dayBackfilled: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  dayMissed: { borderColor: colors.amber, borderStyle: 'dashed' },
  dayToday: { borderColor: colors.ink },
  daySelected: { borderColor: colors.tealDeep, borderWidth: 2.5 },
  dayText: { fontSize: fontSize.sm, fontWeight: '600', color: colors.ink, fontFamily: fontFamily.semibold },
  dayTextOn: { color: '#fff' },
  dayTextInert: { color: colors.line },
  /** Holds the day's markers in a row so two can coexist without overlapping. */
  markers: {
    position: 'absolute',
    bottom: 3,
    flexDirection: 'row',
    gap: 3,
    alignItems: 'center',
  },
  missedDot: {
    width: 4,
    height: 4,
    borderRadius: 2, // Half of 4 — a circle, not a scale step.
    backgroundColor: colors.amber,
  },
  /**
   * Footage exists for this day.
   *
   * Teal, the app's own accent, rather than the red used for seizures: this
   * dot means "there is a video here", not "this was a bad day". A red dot on
   * a calendar of otherwise neutral marks reads as an alarm, and an owner
   * scanning for a clip to show their vet is not in an emergency.
   */
  videoDot: {
    width: 4,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.teal,
  },

  summaryPanel: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  summaryHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  summaryDate: { fontSize: fontSize.md, fontWeight: '700', color: colors.ink, flexShrink: 1, fontFamily: fontFamily.bold },
  summaryGrid: { flexDirection: 'row', flexWrap: 'wrap', marginTop: spacing.sm },
  summaryFact: { width: '33.33%', paddingRight: spacing.sm, marginBottom: spacing.sm },
  summaryFactWide: { width: '100%', paddingRight: 0 },
  summaryLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.5,
    color: colors.inkSoft,
    fontFamily: fontFamily.bold
  },
  summaryValue: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.ink,
    marginTop: 1,
    fontFamily: fontFamily.semibold
  },
  summaryNote: { marginTop: spacing.sm },
  editRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
    marginTop: spacing.xs,
  },
  editLabel: { color: colors.tealDeep, fontWeight: '700', fontFamily: fontFamily.bold },

  legend: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.md,
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },
  legendItem: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  legendVideo: {
    backgroundColor: colors.teal,
    borderColor: colors.teal,
    // Shrunk to the dot's own footprint rather than filling the 14pt swatch:
    // a teal square would read as a third day-status, which it is not.
    transform: [{ scale: 0.45 }],
  },
  legendSwatch: {
    width: 14,
    height: 14,
    borderRadius: 7,
    borderWidth: 1.5,
    borderColor: 'transparent',
  },
  legendLabel: { fontSize: fontSize.xs, fontFamily: fontFamily.regular },

  summary: { marginTop: spacing.md, color: colors.inkSoft },
  doneBtn: { marginTop: spacing.md, minHeight: MIN_TOUCH_TARGET },
});
