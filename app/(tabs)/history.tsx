/**
 * Records — seizure history AND the pattern analysis, in one screen.
 *
 * ── WHY PATTERNS MERGED IN HERE ───────────────────────────────────────
 *
 * They answered the same question from two tabs: "how has this been going?"
 * Splitting the summary from the records it came from meant an owner reading
 * "more than usual" had to change tabs to see which seizures caused it.
 *
 * ── LAYOUT, FROM THE REFERENCE DESIGN ─────────────────────────────────
 *
 * Profile header (avatar + name) → stat-card grid with inline mini-charts →
 * sectioned record list. The COLOURS are unchanged: this stays on the existing
 * cream / white / ink / teal tokens, not the reference's blues.
 *
 * ── THE HARD RULE SURVIVES THE REDESIGN ───────────────────────────────
 *
 * Below three seizures NO chart renders — enforced by the discriminated union
 * from src/features/analytics, so the "insufficient" branch has no shape a
 * chart could be drawn from. The stat cards degrade to em-dashes rather than
 * to zeroes, because a zero reads as a measurement.
 *
 * ── TWO FILTERS, DELIBERATELY ─────────────────────────────────────────
 *
 * "What am I looking at" (Seizures only / Everything) and "how far back"
 * (All time / 90 / 30 days) are orthogonal questions, so both controls stay.
 * Collapsing them into one would make choices like "seizures, 30 days"
 * unreachable.
 *
 * ── THE DURATION PILL ─────────────────────────────────────────────────
 *
 * Colour follows the owner's OWN thresholds from settings, not hardcoded 3/5
 * minute marks — care plans differ between vets. The pill always carries the
 * duration as text, so colour is a second channel and never the only one, and
 * a record with no dependable duration shows "Not timed" rather than a painted
 * guess.
 */

import { useCallback, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body, Card, Disclaimer, EmptyState, Heading, Muted, Pill, SegmentedControl,
  type PillTone,
} from '@/components/ui';
import { SegmentMeter, Sparkline, StatCard } from '@/components/stats';
import { colors, eventColors, fontSize, radius, spacing } from '@/theme/tokens';
import { useChromeMetrics } from '@/theme/chrome';
import { useActiveDog, useAppStore } from '@/store/appStore';
import * as seizureRepo from '@/db/seizureRepo';
import * as checkinRepo from '@/db/checkinRepo';
import * as medicationRepo from '@/db/medicationRepo';
import { formatDuration, DAY_MS } from '@/utils/time';
import {
  buildEvents, dayLabel, groupByDay,
  type TimelineEvent, type TimelineEventKind,
} from '@/features/timeline';
import {
  buildPatternReport, CONFIDENCE_BLURB, monthlyCounts,
  type Confidence, type PatternReport,
} from '@/features/analytics';
import type {
  DailyCheckin, MedicationDose, Seizure, Settings,
} from '@/types/domain';

const CONFIDENCE_TONE: Record<Confidence, PillTone> = {
  early: 'neutral', possible: 'amber', repeated: 'teal', strong: 'green',
};

type ViewMode = 'seizures' | 'everything';
type Range = 'all' | '30d' | '90d';

const RANGE_DAYS: Record<Range, number | null> = { all: null, '30d': 30, '90d': 90 };

const KIND_META: Record<TimelineEventKind, { color: string; glyph: string; label: string }> = {
  seizure: { color: eventColors.seizure, glyph: '●', label: 'Seizure' },
  medication: { color: eventColors.medication, glyph: '■', label: 'Medication' },
  checkin: { color: eventColors.checkin, glyph: '◆', label: 'Check-in' },
};

function durationTone(
  durationSec: number,
  confidence: Seizure['durationConfidence'] | undefined,
  settings: Settings,
): PillTone {
  if (confidence === 'unreliable' || durationSec === 0) return 'neutral';
  const minutes = durationSec / 60;
  if (minutes >= settings.thresholdCritMin) return 'red';
  if (minutes >= settings.thresholdWarnMin) return 'amber';
  return 'teal';
}

export default function RecordsScreen() {
  const insets = useSafeAreaInsets();
  const { contentClearance } = useChromeMetrics();
  const router = useRouter();
  const dog = useActiveDog();
  const settings = useAppStore((s) => s.settings);

  const [seizures, setSeizures] = useState<Seizure[]>([]);
  const [checkins, setCheckins] = useState<DailyCheckin[]>([]);
  const [doses, setDoses] = useState<(MedicationDose & { medicationName: string })[]>([]);
  const [view, setView] = useState<ViewMode>('seizures');
  const [range, setRange] = useState<Range>('all');
  const [loaded, setLoaded] = useState(false);

  const dogId = dog?.id;

  useFocusEffect(
    useCallback(() => {
      if (!dogId) return;
      let cancelled = false;
      (async () => {
        try {
          const [s, c, d] = await Promise.all([
            seizureRepo.listSeizures(dogId),
            checkinRepo.listCheckins(dogId),
            medicationRepo.listRecentDoses(dogId),
          ]);
          if (!cancelled) {
            setSeizures(s);
            setCheckins(c);
            setDoses(d);
          }
        } catch (e) {
          console.error('[history] load failed', e);
        } finally {
          if (!cancelled) setLoaded(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [dogId]),
  );

  const report: PatternReport = useMemo(
    () => buildPatternReport(seizures, checkins, Date.now()),
    [seizures, checkins],
  );

  const sections = useMemo(() => {
    const days = RANGE_DAYS[range];
    const cutoff = days === null ? 0 : Date.now() - days * DAY_MS;
    const everything = view === 'everything';

    const events = buildEvents({
      seizures: seizures.filter((s) => s.start >= cutoff),
      checkins: everything ? checkins.filter((c) => c.timestamp >= cutoff) : [],
      doses: everything ? doses.filter((d) => d.recordedAt >= cutoff) : [],
      include: { seizure: true, medication: everything, checkin: everything },
    });

    return groupByDay(events, (day) => dayLabel(day));
  }, [seizures, checkins, doses, view, range]);

  if (!dog) return null;

  const totalSeizures = seizures.length;

  return (
    <View style={styles.screen}>
      <SectionList
        sections={sections}
        keyExtractor={(item) => item.id}
        stickySectionHeadersEnabled={false}
        contentContainerStyle={[
          styles.listContent,
          { paddingTop: insets.top + spacing.md, paddingBottom: contentClearance },
        ]}
        ListHeaderComponent={
          <View>
            <Text style={styles.screenTitle}>Records</Text>
            <Muted style={styles.intro}>
              How things have been going for {dog.name}.
            </Muted>

            <Text style={styles.sectionTitle}>Overview</Text>
            <StatGrid seizures={seizures} report={report} loaded={loaded} />

            {report.kind === 'report' ? (
              <PatternDetail report={report} />
            ) : (
              loaded && <NotEnoughData count={report.seizureCount} needed={report.needed} />
            )}

            <Text style={styles.sectionTitle}>
              {totalSeizures === 0
                ? 'No records yet'
                : `${totalSeizures} seizure record${totalSeizures === 1 ? '' : 's'}`}
            </Text>
            <View style={styles.filter}>
              <SegmentedControl<ViewMode>
                accessibilityLabel="Choose what to show"
                value={view}
                onChange={setView}
                options={[
                  { value: 'seizures', label: 'Seizures only' },
                  { value: 'everything', label: 'Everything' },
                ]}
              />
            </View>
            <View style={styles.filterTight}>
              <SegmentedControl<Range>
                accessibilityLabel="Filter by time range"
                value={range}
                onChange={setRange}
                options={[
                  { value: 'all', label: 'All time' },
                  { value: '90d', label: '90 days' },
                  { value: '30d', label: '30 days' },
                ]}
              />
            </View>
          </View>
        }
        renderSectionHeader={({ section }) => (
          <Text style={styles.dayHeader}>{section.title}</Text>
        )}
        renderItem={({ item, index, section }) => (
          <EventRow
            event={item}
            settings={settings}
            isLast={index === section.data.length - 1}
            onPress={
              item.seizureId
                ? () => router.push(`/seizure-detail/${item.seizureId}`)
                : undefined
            }
          />
        )}
        ListEmptyComponent={
          <Card>
            {!loaded ? (
              <Muted>Reading records…</Muted>
            ) : totalSeizures === 0 && view === 'seizures' ? (
              <EmptyState
                icon="records"
                title="No seizures recorded"
                body="When one happens, tap Record seizure on the Home tab. Starting the timer straight away is what makes the record useful to your vet."
              />
            ) : (
              <EmptyState
                icon="records"
                title="Nothing in this range"
                body="Try a wider time range, or switch to Everything to include check-ins and doses."
              />
            )}
          </Card>
        }
      />
    </View>
  );
}

/* ------------------------------------------------------------------ */
/* Stat grid                                                           */
/* ------------------------------------------------------------------ */

function StatGrid({
  seizures,
  report,
  loaded,
}: {
  seizures: Seizure[];
  report: PatternReport;
  loaded: boolean;
}) {
  const now = Date.now();
  const last = seizures[0];
  const daysSince = last ? Math.floor((now - last.start) / DAY_MS) : null;
  const month = seizures.filter((s) => now - s.start < 30 * DAY_MS);
  const trend = useMemo(() => monthlyCounts(seizures, 6, now), [seizures, now]);

  // Only the "report" branch carries analysis. Below the threshold these stay
  // null and every card shows an em-dash — never a zero, which reads as a
  // measured value rather than an absence of one.
  const timed = report.kind === 'report' ? report.duration : null;
  const bands = report.kind === 'report' ? report.bands : null;
  const busiest = bands
    ? bands.reduce((a, b) => (b.count > a.count ? b : a), bands[0]!)
    : null;

  return (
    <View style={styles.grid}>
      <StatCard
        label="Days since last seizure"
        value={!loaded || daysSince === null ? '—' : String(daysSince)}
        icon="calendar"
        accessibilityLabel={
          daysSince === null
            ? 'No seizures recorded yet'
            : `${daysSince} days since the last seizure`
        }
      >
        <Muted style={styles.cardFoot}>
          {last
            ? new Date(last.start).toLocaleDateString(undefined, {
                day: 'numeric', month: 'short',
              })
            : 'None recorded'}
        </Muted>
      </StatCard>

      <StatCard label="Last 30 days" value={String(month.length)} unit="recorded" icon="trend">
        {/* Six calendar months, quiet months included as zeros — dropping them
            would compress a good spell out of the picture. */}
        <Sparkline values={trend} height={38} />
      </StatCard>

      <StatCard
        label="Typical length"
        value={timed?.medianSec != null ? formatDuration(timed.medianSec) : '—'}
        icon="timer"
        accessibilityLabel={
          timed?.medianSec != null
            ? `Typical seizure length ${formatDuration(timed.medianSec)}, the median of ${timed.count} timed records`
            : 'Not enough timed records to show a typical length'
        }
      >
        <Muted style={styles.cardFoot}>
          {timed?.medianSec != null ? `median of ${timed.count}` : 'needs 3 records'}
        </Muted>
      </StatCard>

      <StatCard
        label="Most often"
        value={busiest && busiest.count > 0 ? busiest.label : '—'}
        icon="night"
        accessibilityLabel={
          busiest && busiest.count > 0
            ? `Most seizures happen in the ${busiest.label.toLowerCase()}: ${busiest.count} of ${seizures.length}`
            : 'Not enough records to show a time of day'
        }
      >
        {bands && busiest && busiest.count > 0 ? (
          <SegmentMeter
            total={bands.length}
            active={bands.findIndex((b) => b.key === busiest.key) + 1}
            height={24}
          />
        ) : (
          <Muted style={styles.cardFoot}>needs 3 records</Muted>
        )}
      </StatCard>
    </View>
  );
}

/* ------------------------------------------------------------------ */

function NotEnoughData({ count, needed }: { count: number; needed: number }) {
  return (
    <Card>
      <Heading>Patterns appear at {needed} seizures</Heading>
      <Muted style={{ marginTop: 6 }}>
        {count} recorded so far. Nothing is charted before then, because a
        pattern drawn from {count === 1 ? 'one record' : `${count} records`} would
        change completely with the next one.
      </Muted>
    </Card>
  );
}

function PatternDetail({ report }: { report: Extract<PatternReport, { kind: 'report' }> }) {
  return (
    <>
      <Card>
        <View style={styles.row}>
          <Heading>Compared with usual</Heading>
          <Pill label={report.confidence} tone={CONFIDENCE_TONE[report.confidence]} />
        </View>
        <Body style={{ marginTop: 6 }}>{report.frequency.summary}</Body>
        <Muted style={{ marginTop: 6 }}>{CONFIDENCE_BLURB[report.confidence]}</Muted>
      </Card>

      {report.associations.map((a) => (
        <Card key={a.id}>
          <View style={styles.row}>
            <Heading>{a.title}</Heading>
            <Pill label={`${a.sampleSize} days`} tone="neutral" />
          </View>
          <Body style={{ marginTop: 6 }}>{a.finding}</Body>
        </Card>
      ))}

      <Disclaimer>
        Everything above describes things recorded together in your own logs. It
        does not show that one caused the other, and it is not a substitute for
        talking to your veterinarian.
      </Disclaimer>
    </>
  );
}

/* ------------------------------------------------------------------ */

function EventRow({
  event,
  settings,
  isLast,
  onPress,
}: {
  event: TimelineEvent;
  settings: Settings;
  isLast: boolean;
  onPress?: () => void;
}) {
  const meta = KIND_META[event.kind];
  const time = new Date(event.timestamp).toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit',
  });
  const untimed = event.durationConfidence === 'unreliable' || event.durationSec === 0;

  const content = (
    <View style={styles.eventRow}>
      <View style={styles.rail}>
        <Text style={[styles.dot, { color: meta.color }]}>{meta.glyph}</Text>
        {!isLast && <View style={styles.railLine} />}
      </View>

      <View style={styles.eventBody}>
        <View style={styles.eventTop}>
          <Text style={[styles.eventKind, { color: meta.color }]}>{meta.label}</Text>
          <Text style={styles.eventTime}>{time}</Text>
        </View>

        <Body style={styles.eventDetail} numberOfLines={2}>
          {event.detail}
        </Body>

        {(event.durationSec !== undefined || event.retrospective) && (
          <View style={styles.badges}>
            {event.durationSec !== undefined && (
              <Pill
                label={untimed ? 'Not timed' : formatDuration(event.durationSec)}
                tone={durationTone(event.durationSec, event.durationConfidence, settings)}
              />
            )}
            {event.retrospective && <Pill label="Logged later" tone="neutral" />}
            {event.durationConfidence === 'recovered' && (
              <Pill label="Estimated duration" tone="amber" />
            )}
          </View>
        )}
      </View>
    </View>
  );

  if (!onPress) return content;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${meta.label} at ${time}. ${event.detail}`}
      style={({ pressed }) => (pressed ? styles.pressed : undefined)}
    >
      {content}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  listContent: { paddingHorizontal: spacing.lg },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  screenTitle: {
    fontSize: fontSize.display,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.5,
  },
  sectionTitle: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.3,
    marginTop: spacing.lg,
    marginBottom: spacing.md,
  },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginBottom: spacing.md },
  cardFoot: { marginTop: 2 },

  intro: { marginBottom: spacing.md },
  filter: { marginBottom: spacing.sm },
  filterTight: { marginBottom: spacing.sm },

  dayHeader: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.inkSoft,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },

  eventRow: { flexDirection: 'row', gap: spacing.md },
  rail: { width: 14, alignItems: 'center' },
  dot: { fontSize: 13, lineHeight: 18 },
  railLine: { flex: 1, width: 1.5, backgroundColor: colors.line, marginTop: 2 },
  eventBody: {
    flex: 1,
    backgroundColor: colors.card,
    borderRadius: radius.sm,
    borderWidth: 1,
    borderColor: colors.line,
    padding: spacing.md,
    marginBottom: spacing.sm,
  },
  eventTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  eventKind: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
  },
  eventTime: { fontSize: fontSize.sm, color: colors.inkSoft, fontVariant: ['tabular-nums'] },
  eventDetail: { marginTop: 4 },
  badges: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm, marginTop: spacing.sm },
  pressed: { opacity: 0.7 },
});
