/**
 * The detail report — everything about one dog in the order a vet asks for it.
 *
 * Profile → seizure summary → seizure list → medication history with dates →
 * check-in coverage.
 *
 * ── WHY THE ORDER ─────────────────────────────────────────────────────
 *
 * A consultation starts with "who is this dog", moves to "what has been
 * happening", then "what are they on". The report follows that so an owner can
 * scroll it live while talking rather than hunting between screens.
 *
 * ── WHAT THE REPORT REFUSES TO DO ─────────────────────────────────────
 *
 * It reports, it never concludes. No trend is called an improvement, no
 * association is called a cause, and no medication is assessed as working or
 * not working. Where the data is weak the report SAYS so — estimated
 * durations, backfilled check-ins and small sample sizes are all labelled
 * rather than smoothed over, because a vet reading a clean-looking number
 * cannot tell it was a guess.
 */

import { useCallback, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body, Button, Card, Disclaimer, Heading, Muted, Pill, SectionTitle, Title,
} from '@/components/ui';
import { DogAvatar } from '@/components/ProfileHeader';
import { colors, fontSize, spacing } from '@/theme/tokens';
import { goBackOrHome } from '@/utils/nav';
import { useActiveDog } from '@/store/appStore';
import { breedDisplay } from '@/db/dogRepo';
import * as seizureRepo from '@/db/seizureRepo';
import * as checkinRepo from '@/db/checkinRepo';
import * as medicationRepo from '@/db/medicationRepo';
import { formatDuration, localDayKey, DAY_MS } from '@/utils/time';
import { buildPatternReport, durationStats } from '@/features/analytics';
import {
  DOSE_STATUS_LABEL,
  type DailyCheckin, type MedicationDose, type MedicationWithReminders,
  type Seizure,
} from '@/types/domain';

export default function ReportScreen() {
  const insets = useSafeAreaInsets();
  const router = useRouter();
  const dog = useActiveDog();

  const [seizures, setSeizures] = useState<Seizure[]>([]);
  const [checkins, setCheckins] = useState<DailyCheckin[]>([]);
  const [meds, setMeds] = useState<MedicationWithReminders[]>([]);
  const [doses, setDoses] = useState<(MedicationDose & { medicationName: string })[]>([]);
  const [loaded, setLoaded] = useState(false);

  const dogId = dog?.id;

  useFocusEffect(
    useCallback(() => {
      if (!dogId) return;
      let cancelled = false;
      (async () => {
        try {
          const [s, c, m, d] = await Promise.all([
            seizureRepo.listSeizures(dogId),
            checkinRepo.listCheckins(dogId),
            medicationRepo.listMedications(dogId),
            medicationRepo.listRecentDoses(dogId),
          ]);
          if (!cancelled) {
            setSeizures(s);
            setCheckins(c);
            setMeds(m);
            setDoses(d);
          }
        } catch (e) {
          console.error('[report] load failed', e);
        } finally {
          if (!cancelled) setLoaded(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [dogId]),
  );

  const duration = useMemo(() => durationStats(seizures), [seizures]);
  const report = useMemo(
    () => buildPatternReport(seizures, checkins, Date.now()),
    [seizures, checkins],
  );

  /** Doses grouped by day, newest first — the medication history proper. */
  const doseDays = useMemo(() => {
    const byDay = new Map<string, (MedicationDose & { medicationName: string })[]>();
    for (const d of doses) {
      const list = byDay.get(d.doseDate);
      if (list) list.push(d);
      else byDay.set(d.doseDate, [d]);
    }
    return [...byDay.entries()].sort((a, b) => b[0].localeCompare(a[0]));
  }, [doses]);

  const coverage = useMemo(() => {
    if (seizures.length === 0 && checkins.length === 0) return null;
    const oldest = Math.min(
      ...[...seizures.map((s) => s.start), ...checkins.map((c) => c.timestamp)],
    );
    const days = Math.max(1, Math.round((Date.now() - oldest) / DAY_MS) + 1);
    const backfilled = checkins.filter((c) => c.backfilled).length;
    return { days, recorded: checkins.length, backfilled };
  }, [seizures, checkins]);

  if (!dog) return null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <Title>Report</Title>
      <Muted style={styles.intro}>
        Everything recorded for {dog.name}, in the order a vet usually asks for it.
      </Muted>

      {/* --- Who ---------------------------------------------------- */}
      <Card style={{ marginTop: spacing.md }}>
        <View style={styles.dogRow}>
          <DogAvatar photoUri={dog.photoUri} size={56} />
          <View style={styles.flexOne}>
            <Heading>{dog.name}</Heading>
            <Muted>{breedDisplay(dog)}</Muted>
          </View>
        </View>
        <View style={styles.factGrid}>
          <Fact label="Sex" value={dog.sex ? dog.sex : '—'} />
          <Fact label="Age" value={dog.ageYears === null ? '—' : `${dog.ageYears} yrs`} />
          <Fact label="Weight" value={dog.weightKg === null ? '—' : `${dog.weightKg} kg`} />
          <Fact label="Diagnosis" value={dog.diagnosisStatus} />
          <Fact label="First seizure" value={dog.firstSeizureDate || '—'} />
          <Fact label="Seizure type" value={dog.seizureType || '—'} />
        </View>
        {(dog.allergies || dog.diet) && (
          <View style={styles.notesBlock}>
            {dog.allergies ? <Line label="Allergies" value={dog.allergies} /> : null}
            {dog.diet ? <Line label="Diet" value={dog.diet} /> : null}
          </View>
        )}
      </Card>

      {/* --- Seizure summary ---------------------------------------- */}
      <SectionTitle>Seizures</SectionTitle>
      <Card>
        {seizures.length === 0 ? (
          <Muted>{loaded ? 'None recorded.' : 'Loading…'}</Muted>
        ) : (
          <>
            <View style={styles.factGrid}>
              <Fact label="Recorded" value={String(seizures.length)} />
              <Fact
                label="Typical length"
                value={duration.medianSec === null ? '—' : formatDuration(duration.medianSec)}
              />
              <Fact
                label="Longest"
                value={duration.longestSec === null ? '—' : formatDuration(duration.longestSec)}
              />
            </View>
            <Muted style={styles.caveat}>
              &ldquo;Typical&rdquo; is the median of {duration.count} reliably timed
              seizures, not the average.
              {duration.excludedCount > 0 &&
                ` ${duration.excludedCount} record${duration.excludedCount === 1 ? '' : 's'} had no dependable timing and ${duration.excludedCount === 1 ? 'was' : 'were'} left out.`}
            </Muted>
            {report.kind === 'report' && (
              <Muted style={styles.caveat}>{report.frequency.summary}</Muted>
            )}
          </>
        )}
      </Card>

      {seizures.slice(0, 12).map((s) => (
        <Card key={s.id}>
          <View style={styles.row}>
            <Body style={styles.bold}>
              {new Date(s.start).toLocaleDateString(undefined, {
                weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
              })}
            </Body>
            <Pill
              // "Not timed" means no duration exists. An owner-stated length on
              // an imported record carries 'unreliable' by design, and printing
              // "Not timed" over it on the document an owner hands their vet
              // discards a number the app asked them for. The neutral tone still
              // distinguishes it from a measured figure.
              label={
                s.durationSec === null || s.durationSec === 0
                  ? 'Not timed'
                  : formatDuration(s.durationSec)
              }
              tone={s.durationConfidence === 'unreliable' ? 'neutral' : 'teal'}
            />
          </View>
          <Muted style={{ marginTop: 4 }}>
            {new Date(s.start).toLocaleTimeString(undefined, {
              hour: 'numeric', minute: '2-digit',
            })}
            {s.ictalObs.length > 0 && ` · ${s.ictalObs.join(', ')}`}
          </Muted>
          {(s.retrospective || s.durationConfidence === 'recovered') && (
            <View style={styles.badges}>
              {s.retrospective && <Pill label="Logged later" tone="neutral" />}
              {s.durationConfidence === 'recovered' && (
                <Pill label="Estimated duration" tone="amber" />
              )}
            </View>
          )}
        </Card>
      ))}
      {seizures.length > 12 && (
        <Muted style={styles.more}>
          Showing the 12 most recent of {seizures.length}.
        </Muted>
      )}

      {/* --- Medication --------------------------------------------- */}
      <SectionTitle>Medication</SectionTitle>
      {meds.length === 0 ? (
        <Card>
          <Muted>{loaded ? 'None recorded.' : 'Loading…'}</Muted>
        </Card>
      ) : (
        <Card>
          {meds.map((m, i) => (
            <View key={m.id} style={i > 0 ? styles.medDivider : undefined}>
              <Body style={styles.bold}>{m.name}</Body>
              <Muted style={{ marginTop: 2 }}>
                {[
                  [m.dose, m.unit].filter((x) => x.trim()).join(''),
                  m.frequency,
                  m.reminders.length > 0
                    ? m.reminders.map((r) => r.timeHHMM).join(', ')
                    : null,
                ]
                  .filter(Boolean)
                  .join(' · ') || 'No amount recorded'}
              </Muted>
              {m.prescriber ? (
                <Muted style={{ marginTop: 2 }}>Prescribed by {m.prescriber}</Muted>
              ) : null}
            </View>
          ))}
        </Card>
      )}

      {/* --- Medication history, by date ---------------------------- */}
      {doseDays.length > 0 && (
        <>
          <SectionTitle>Doses given</SectionTitle>
          {doseDays.slice(0, 30).map(([day, entries]) => (
            <Card key={day}>
              <Body style={styles.bold}>{formatDay(day)}</Body>
              {entries
                .sort((a, b) => a.scheduledHHMM.localeCompare(b.scheduledHHMM))
                .map((d) => (
                  <View key={d.id} style={styles.doseRow}>
                    <Text style={styles.doseTime}>{d.scheduledHHMM || '—'}</Text>
                    <Muted style={styles.flexOne}>{d.medicationName}</Muted>
                    <Pill
                      label={DOSE_STATUS_LABEL[d.status]}
                      tone={
                        d.status === 'given' ? 'green' : d.status === 'late' ? 'amber' : 'red'
                      }
                    />
                  </View>
                ))}
            </Card>
          ))}
          {doseDays.length > 30 && (
            <Muted style={styles.more}>
              Showing the 30 most recent days of {doseDays.length}.
            </Muted>
          )}
        </>
      )}

      {/* --- Check-in coverage -------------------------------------- */}
      <SectionTitle>Check-in coverage</SectionTitle>
      <Card>
        {coverage === null ? (
          <Muted>{loaded ? 'Nothing recorded yet.' : 'Loading…'}</Muted>
        ) : (
          <>
            <Body>
              {coverage.recorded} check-in{coverage.recorded === 1 ? '' : 's'} across{' '}
              {coverage.days} days of records.
            </Body>
            {coverage.backfilled > 0 && (
              <Muted style={styles.caveat}>
                {coverage.backfilled} of those {coverage.backfilled === 1 ? 'was' : 'were'}{' '}
                filled in after the day it describes, so {coverage.backfilled === 1 ? 'it rests' : 'they rest'} on memory rather than
                same-day observation.
              </Muted>
            )}
            <Muted style={styles.caveat}>
              Ordinary days are what seizure days are compared against. Gaps do not
              invalidate anything here; they just make comparisons weaker.
            </Muted>
          </>
        )}
      </Card>

      <Disclaimer>
        This report describes what was recorded in this app. It does not
        diagnose, and it does not show that one thing caused another. Bring it to
        your veterinarian rather than acting on it.
      </Disclaimer>

      {/* This screen has no header, so without an explicit exit the only way
          out is the iOS edge-swipe — and nothing at all on Android. */}
      <Button
        label="Done"
        variant="ghost"
        onPress={() => goBackOrHome(router)}
        style={{ marginTop: spacing.lg }}
      />
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */

function formatDay(dayKey: string): string {
  const d = new Date(`${dayKey}T12:00:00`);
  const today = localDayKey();
  if (dayKey === today) return 'Today';
  return d.toLocaleDateString(undefined, {
    weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
  });
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.fact} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.factLabel}>{label}</Text>
      <Text style={styles.factValue}>{value}</Text>
    </View>
  );
}

function Line({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.line}>
      <Text style={styles.factLabel}>{label}</Text>
      <Body style={{ marginTop: 2 }}>{value}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  intro: { marginTop: spacing.sm },
  flexOne: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  bold: { fontWeight: '700' },

  dogRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },

  factGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.md,
    rowGap: spacing.md,
  },
  fact: { width: '33.33%', paddingRight: spacing.sm },
  factLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.6,
    textTransform: 'uppercase',
    color: colors.inkSoft,
  },
  factValue: {
    fontSize: fontSize.base,
    fontWeight: '600',
    color: colors.ink,
    marginTop: 2,
    textTransform: 'capitalize',
  },

  notesBlock: {
    marginTop: spacing.md,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    gap: spacing.sm,
  },
  line: {},

  caveat: { marginTop: spacing.sm },
  more: { textAlign: 'center', marginBottom: spacing.md },
  badges: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.sm },

  medDivider: {
    marginTop: spacing.md,
    paddingTop: spacing.md,
    borderTopWidth: 1,
    borderTopColor: colors.line,
  },

  doseRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  doseTime: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
    minWidth: 48,
  },
});
