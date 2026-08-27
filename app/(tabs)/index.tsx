/**
 * Home / dashboard.
 *
 * The single most important thing on this screen is the Record Seizure card.
 * It starts the timer on a single tap with no confirmation dialog — a
 * confirmation step would cost seconds during an emergency and add nothing.
 *
 * ── THE ORDER OF THIS SCREEN IS THE DESIGN ────────────────────────────
 *
 *   1. Header           who this is, and the two controls that act on them.
 *   2. Daily pulse      the one thing the app asks the owner FOR, every day.
 *   3. Instant recorder the one thing the owner needs FROM the app, urgently.
 *   4. Data dashboard   the trend, then the reference figures beside it.
 *   5. Recent videos    clips, filed by when the seizure happened.
 *   6. Last seizure     the record behind the headline number.
 *
 * ── THE ENERGY FACES ARE REAL DATA, NOT A MOOD TOY ────────────────────
 *
 * The five faces are `daily_checkins.energy`, the 1-5 scale the check-in form
 * already calls "Flat ↔ Bouncy". They are not a new field invented for a
 * dashboard, and they are labelled with the same words, so the row on Home and
 * the control in the form cannot drift apart in an owner's head.
 *
 * Tapping one EDITS today's check-in when it exists, and opens the form when it
 * does not. That asymmetry is deliberate: `upsertCheckinForDate` writes the
 * whole row, so creating one from a single tap here would silently record
 * appetite, water, stress and GI as "normal" on a day the owner never
 * described. A fabricated control dataset is worse than an absent one — the
 * pattern analysis measures seizure days against exactly these rows.
 *
 * The palette is unchanged — it was already validated for colour-vision
 * deficiency and stays exactly as it is. What was missing was structure.
 */

import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';
import * as Haptics from 'expo-haptics';

import { Body, Card, Disclaimer, Muted, Pill } from '@/components/ui';
import { SectionRule } from '@/components/form';
import { Icon, type IconName } from '@/components/Icon';
import { VideoTile } from '@/components/VideoTile';
import { colors, fontSize, radius, shadow, spacing, MIN_TOUCH_TARGET } from '@/theme/tokens';
import { useChromeMetrics } from '@/theme/chrome';
import { useActiveDog, useAppStore } from '@/store/appStore';
import { useActiveSeizure } from '@/store/activeSeizureStore';
import { breedDisplay } from '@/db/dogRepo';
import { DogAvatar } from '@/components/ProfileHeader';
import * as seizureRepo from '@/db/seizureRepo';
import * as checkinRepo from '@/db/checkinRepo';
import * as videoRepo from '@/db/videoRepo';
import { formatDuration } from '@/utils/time';
import type { DailyCheckin, GalleryEntry, Seizure } from '@/types/domain';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** How many clips the home strip previews before deferring to "See all". */
const VIDEO_PREVIEW_COUNT = 4;

/** Weekly buckets in the trend sparkline. Eight weeks is two months of shape. */
const TREND_WEEKS = 8;

/**
 * The five steps of `daily_checkins.energy`, each carrying its own face, name
 * and colour.
 *
 * Every face is tinted with its OWN state at rest, so the row reads as a scale
 * from flat to bouncy before anything is selected — a row of five identical
 * grey circles says "pick a number", not "how is your dog". The selected step
 * fills solid.
 *
 * Colour is never the only channel: the face shape, the position in the row and
 * the name printed underneath all carry the same thing. That matters here
 * because the ends of this scale are red and green, which is the pairing the
 * event palette in tokens.ts deliberately avoids relying on alone.
 */
const ENERGY_STEPS: {
  icon: IconName;
  name: string;
  tint: string;
  ink: string;
  solid: string;
}[] = [
  { icon: 'energy1', name: 'Flat', tint: colors.redTint, ink: colors.redDeep, solid: colors.red },
  { icon: 'energy2', name: 'Low', tint: colors.amberTint, ink: colors.amberInk, solid: colors.amber },
  { icon: 'energy3', name: 'Steady', tint: colors.bg, ink: colors.inkSoft, solid: colors.inkSoft },
  { icon: 'energy4', name: 'Good', tint: colors.tealTint, ink: colors.tealDeep, solid: colors.teal },
  { icon: 'energy5', name: 'Bouncy', tint: colors.greenTint, ink: colors.greenInk, solid: colors.green },
];

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { contentClearance } = useChromeMetrics();
  const dog = useActiveDog();
  const settings = useAppStore((s) => s.settings);
  const startSeizure = useActiveSeizure((s) => s.start);

  const [seizures, setSeizures] = useState<Seizure[]>([]);
  const [videos, setVideos] = useState<GalleryEntry[]>([]);
  const [checkin, setCheckin] = useState<DailyCheckin | null>(null);
  const [loading, setLoading] = useState(true);

  const dogId = dog?.id;

  const load = useCallback(async () => {
    if (!dogId) return;
    try {
      const [list, today, gallery] = await Promise.all([
        seizureRepo.listSeizuresSince(dogId, Date.now() - 400 * DAY_MS),
        checkinRepo.getTodaysCheckin(dogId),
        // Best-effort: the video strip is a nicety and must never be the
        // reason the dashboard fails to render.
        videoRepo.listGallery(dogId).catch(() => [] as GalleryEntry[]),
      ]);
      setSeizures(list);
      setCheckin(today);
      setVideos(gallery);
    } catch (e) {
      console.error('[home] load failed', e);
    } finally {
      setLoading(false);
    }
  }, [dogId]);

  // useFocusEffect (not useEffect) so the dashboard refreshes every time the
  // user returns to it — e.g. straight after saving a seizure.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const now = Date.now();

  /** Seizures per week, oldest bucket first. Drives the trend sparkline. */
  const trend = useMemo(() => {
    const buckets = new Array<number>(TREND_WEEKS).fill(0);
    for (const s of seizures) {
      const weeksAgo = Math.floor((now - s.start) / WEEK_MS);
      if (weeksAgo >= 0 && weeksAgo < TREND_WEEKS) {
        // Indexed read is `number | undefined` under noUncheckedIndexedAccess,
        // even though the array was just filled.
        const slot = TREND_WEEKS - 1 - weeksAgo;
        buckets[slot] = (buckets[slot] ?? 0) + 1;
      }
    }
    return buckets;
    // `now` is recomputed every render; bucketing on the seizure list is what
    // actually matters and re-running this on a re-render is cheap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [seizures]);

  if (!dog) return null;

  const last = seizures[0];
  const week = seizures.filter((s) => now - s.start < WEEK_MS);
  const month = seizures.filter((s) => now - s.start < 30 * DAY_MS);
  // Only reliably timed records may feed a duration figure. Averaging in a
  // record whose timing was never captured reports a guess as a measurement —
  // src/features/analytics applies the same rule.
  const timedThisMonth = month.filter(
    (s) => s.durationConfidence !== 'unreliable' && s.durationSec > 0,
  );
  const avgDuration =
    timedThisMonth.length > 0
      ? Math.round(
          timedThisMonth.reduce((sum, s) => sum + s.durationSec, 0) /
            timedThisMonth.length,
        )
      : null;
  const daysSince = last ? Math.floor((now - last.start) / DAY_MS) : null;

  const onRecord = () => {
    if (settings.hapticsEnabled) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    startSeizure(dog.id);
    router.push('/seizure/live');
  };

  /**
   * Setting energy from Home only ever EDITS an existing row — see the note at
   * the top of this file for why it must not create one.
   */
  const onPickEnergy = async (value: number) => {
    if (!checkin) {
      router.push('/(tabs)/checkin');
      return;
    }
    if (settings.hapticsEnabled) {
      void Haptics.selectionAsync();
    }
    // Optimistic, so the row responds under the finger rather than after a
    // database round trip.
    setCheckin({ ...checkin, energy: value });
    try {
      await checkinRepo.upsertTodaysCheckin(dog.id, {
        sleepHrs: checkin.sleepHrs,
        appetite: checkin.appetite,
        water: checkin.water,
        energy: value,
        stress: checkin.stress,
        medOnTime: checkin.medOnTime,
        gi: checkin.gi,
        unusual: checkin.unusual,
      });
    } catch (e) {
      console.error('[home] energy update failed', e);
      void load();
    }
  };

  const preview = videos.slice(0, VIDEO_PREVIEW_COUNT);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: contentClearance },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      {/* --- Header ---------------------------------------------------- */}
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.dogName} numberOfLines={1}>
            {dog.name}
          </Text>
          <Muted numberOfLines={1}>{breedDisplay(dog)}</Muted>
        </View>

        <Pressable
          onPress={() => router.push('/dog-profile')}
          accessibilityRole="button"
          accessibilityLabel={`${dog.name}'s profile`}
          accessibilityHint="Opens the dog profile, where you can add a photo and details"
          hitSlop={6}
          style={({ pressed }) => [styles.avatarBtn, pressed && styles.pressed]}
        >
          <DogAvatar photoUri={dog.photoUri} size={MIN_TOUCH_TARGET} />
        </Pressable>

        <Pressable
          onPress={() => router.push('/more')}
          accessibilityRole="button"
          accessibilityLabel="Settings"
          hitSlop={6}
          style={({ pressed }) => [styles.gearBtn, pressed && styles.pressed]}
        >
          <Icon name="settings" size="lg" color={colors.ink} />
        </Pressable>
      </View>

      {/* --- Daily pulse ----------------------------------------------- */}
      <View style={styles.card}>
        <Text style={styles.eyebrow}>DAILY PULSE</Text>

        <View style={styles.pulseHead}>
          <Text style={styles.cardTitle} numberOfLines={1}>
            How is {dog.name}&apos;s day?
          </Text>
          <Pressable
            onPress={() => router.push('/(tabs)/checkin')}
            accessibilityRole="button"
            accessibilityLabel={checkin ? "Update today's check-in" : 'Check in now'}
            // The pill is drawn at 36pt so it sits beside the title without
            // dominating it; hitSlop takes the TOUCH target to the 48pt floor,
            // which is the number that actually matters to a finger.
            hitSlop={{ top: 6, bottom: 6, left: 8, right: 8 }}
            style={({ pressed }) => [styles.pulseCta, pressed && styles.pressed]}
          >
            <Text style={styles.pulseCtaText}>{checkin ? 'Update' : 'Check-in Now'}</Text>
          </Pressable>
        </View>

        <View
          style={styles.energyRow}
          accessibilityRole="radiogroup"
          accessibilityLabel="Energy today, one to five"
        >
          {ENERGY_STEPS.map((step, i) => {
            const value = i + 1;
            const active = checkin?.energy === value;
            return (
              <Pressable
                key={step.icon}
                onPress={() => void onPickEnergy(value)}
                accessibilityRole="radio"
                accessibilityState={{ selected: active }}
                accessibilityLabel={`${step.name}, ${value} of 5`}
                accessibilityHint={
                  checkin
                    ? "Sets today's energy"
                    : 'Opens the check-in form — nothing is recorded until you finish it'
                }
                style={({ pressed }) => [styles.energyCell, pressed && styles.pressed]}
              >
                <View
                  style={[
                    styles.energyDot,
                    { backgroundColor: active ? step.solid : step.tint },
                    active && { borderColor: step.solid },
                  ]}
                >
                  <Icon
                    name={step.icon}
                    size="md"
                    color={active ? colors.onMedia : step.ink}
                  />
                </View>
                <Text
                  style={[styles.energyName, active && { color: step.ink, fontWeight: '800' }]}
                  numberOfLines={1}
                >
                  {step.name}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.scaleCaption}>
          {checkin
            ? `${dog.name} is ${(ENERGY_STEPS[checkin.energy - 1]?.name ?? 'Steady').toLowerCase()} today`
            : 'Not checked in yet — tap a face to start'}
        </Text>
      </View>

      {/* --- Instant recorder ------------------------------------------
          The one thing on this screen that is correctly loud. */}
      <LinearGradient
        colors={[colors.red, colors.redDeep]}
        start={{ x: 0, y: 0 }}
        end={{ x: 1, y: 1 }}
        style={styles.recorder}
      >
        <Text style={[styles.eyebrow, styles.eyebrowOnRed]}>INSTANT RECORDER</Text>

        <Pressable
          onPress={onRecord}
          accessibilityRole="button"
          accessibilityLabel="Start seizure timer"
          accessibilityHint="Starts the seizure timer immediately"
          style={({ pressed }) => [styles.recorderBtn, pressed && { opacity: 0.85 }]}
        >
          <Text style={styles.recorderKicker}>Tap immediately</Text>
          <Text style={styles.recorderTitle}>Start seizure timer</Text>
          <Text style={styles.recorderClock}>0:00</Text>
        </Pressable>

        <Text style={styles.recorderFoot}>TAP NOW</Text>
      </LinearGradient>

      {/* --- Data dashboard --------------------------------------------- */}
      <View style={styles.card}>
        <View style={styles.rowBetween}>
          <Text style={styles.eyebrow}>DATA DASHBOARD</Text>
          <Pressable
            onPress={() => router.push('/(tabs)/history')}
            accessibilityRole="button"
            accessibilityLabel="Open records and insights"
            hitSlop={10}
            style={({ pressed }) => [styles.insights, pressed && styles.pressed]}
          >
            <Text style={styles.insightsText}>Insights</Text>
          </Pressable>
        </View>

        <View style={styles.dash}>
          <View style={styles.dashLeft}>
            <Sparkline weeks={trend} />
            <Text style={styles.dashValue}>
              {daysSince === null ? '—' : daysSince}
            </Text>
            <Text style={styles.dashLabel}>
              {daysSince === null ? 'No seizures yet' : 'Days since last'}
            </Text>
          </View>

          <View style={styles.dashRight}>
            <MetricRow label="This week" value={String(week.length)} />
            <View style={styles.metricDivider} />
            <MetricRow label="This month" value={String(month.length)} />
            <View style={styles.metricDivider} />
            <MetricRow
              label="Avg. length"
              value={avgDuration === null ? '—' : formatDuration(avgDuration)}
            />
          </View>
        </View>
      </View>

      {/* --- Recent videos ----------------------------------------------
          Nothing at all when there are none: an empty strip is worse than no
          strip, and the gallery already owns the empty state. */}
      {preview.length > 0 ? (
        <>
          <View style={styles.sectionHead}>
            {/* SectionRule carries its own vertical margins; the row owns them
                here instead, or the rule floats above "See all". */}
            <SectionRule label="Recent videos" style={[styles.flex, styles.ruleFlush]} />
            <Pressable
              onPress={() =>
                router.push({
                  pathname: '/(tabs)/history',
                  params: { mode: 'gallery' },
                })
              }
              accessibilityRole="button"
              accessibilityLabel="See all videos"
              hitSlop={10}
              style={({ pressed }) => [styles.seeAll, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.seeAllText}>See all</Text>
            </Pressable>
          </View>

          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            // Bleeds to the screen edge so the last card is visibly cut off —
            // that overhang is what tells the eye the row scrolls.
            style={styles.videoScroll}
            contentContainerStyle={styles.videoScrollContent}
          >
            {preview.map((entry) => (
              <VideoCard
                key={entry.video.id}
                entry={entry}
                onPress={() => router.push(`/video/${entry.video.id}`)}
              />
            ))}
          </ScrollView>
        </>
      ) : null}

      {/* --- Last seizure ------------------------------------------------ */}
      <SectionRule label="Last seizure" />
      {last ? (
        <Pressable
          onPress={() => router.push(`/seizure-detail/${last.id}`)}
          style={({ pressed }) => pressed && styles.pressed}
        >
          <Card>
            <View style={styles.rowBetween}>
              <Body style={styles.semibold}>
                {new Date(last.start).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
                {', '}
                {new Date(last.start).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Body>
              <Pill
                // Absence of a duration, not low confidence in one — see the
                // note in seizure-detail. The tone still keeps an owner-stated
                // length visually distinct from a measured one.
                label={
                  last.durationSec === null || last.durationSec === 0
                    ? 'Not timed'
                    : formatDuration(last.durationSec)
                }
                tone={
                  last.durationConfidence === 'unreliable' || last.durationSec === 0
                    ? 'neutral'
                    : 'teal'
                }
              />
            </View>
            <Muted style={{ marginTop: 6 }} numberOfLines={2}>
              {last.ictalObs.slice(0, 3).join(', ') || 'No observations logged'}
            </Muted>
          </Card>
        </Pressable>
      ) : (
        <Card>
          <Muted>
            {loading
              ? 'Loading…'
              : 'No seizures recorded yet. When one happens, tap Start seizure timer right away.'}
          </Muted>
        </Card>
      )}

      <Disclaimer>
        Patterns shown in this app describe associations observed in your own
        records. They do not diagnose a cause and are not a substitute for
        veterinary care.
      </Disclaimer>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */
/* Pieces                                                              */
/* ------------------------------------------------------------------ */

/**
 * Seizures per week for the last two months, as bars.
 *
 * Bars rather than the reference's line, because a line needs SVG and this app
 * has no SVG dependency — adding one to draw eight points would be a poor
 * trade. Bars carry the same shape and are honest about being buckets.
 *
 * An all-zero history renders as a flat baseline rather than nothing, so the
 * absence of seizures still reads as a result.
 */
function Sparkline({ weeks }: { weeks: number[] }) {
  const peak = Math.max(1, ...weeks);
  const total = weeks.reduce((sum, n) => sum + n, 0);

  return (
    <View
      style={styles.spark}
      accessible
      accessibilityLabel={`${total} seizure${total === 1 ? '' : 's'} in the last ${weeks.length} weeks`}
    >
      {weeks.map((n, i) => (
        // Every week gets a full-height TRACK with its value drawn inside it.
        // Bare bars on a mostly-quiet history rendered as a row of 3pt stubs,
        // which reads as a dashed line rather than a chart — and a quiet history
        // is the normal case here, so that is the case it has to look right in.
        <View key={i} style={styles.sparkTrack}>
          <View
            style={[
              styles.sparkBar,
              {
                height: Math.max(3, Math.round((n / peak) * 26)),
                backgroundColor: n > 0 ? colors.teal : colors.line,
              },
            ]}
          />
        </View>
      ))}
    </View>
  );
}

function MetricRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.metricRow}>
      <Text style={styles.metricLabel} numberOfLines={1}>
        {label}
      </Text>
      <Text style={styles.metricValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

/**
 * A video preview: poster frame, then the day it happened.
 *
 * Filed and labelled by WHEN THE SEIZURE HAPPENED, not when the clip was
 * imported — same rule as the gallery. A clip filmed Tuesday and imported
 * Friday belongs under Tuesday, where it means something.
 */
function VideoCard({ entry, onPress }: { entry: GalleryEntry; onPress: () => void }) {
  const when = new Date(entry.video.timestamp);
  const day = when.toLocaleDateString(undefined, {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
  });
  const time = when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`Seizure video from ${day} at ${time}`}
      style={({ pressed }) => [styles.videoCard, pressed && styles.pressed]}
    >
      <View>
        <VideoTile
          thumbUri={entry.video.thumbUri}
          durationSec={entry.video.durationSec}
          captureConfidence={entry.video.captureConfidence}
          accessibilityLabel={`Seizure video from ${day}`}
          aspect={1.35}
        />
        {/* Centred play affordance. The tile alone reads as a photograph. */}
        <View style={styles.playBadge} pointerEvents="none">
          <View style={styles.playDisc}>
            <Icon name="play" size="md" color={colors.onMedia} filled />
          </View>
        </View>
      </View>
      <Text style={styles.videoTitle} numberOfLines={1}>
        {day}
      </Text>
      <Text style={styles.videoSub} numberOfLines={1}>
        {time}
      </Text>
    </Pressable>
  );
}

const CARD_RADIUS = radius.lg - 4;
const VIDEO_CARD_WIDTH = 150;

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  flex: { flex: 1 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  semibold: { fontWeight: '600' },
  pressed: { opacity: 0.85 },

  /* --- Header ------------------------------------------------------ */
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dogName: {
    fontSize: fontSize.display,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.8,
  },
  avatarBtn: { borderRadius: MIN_TOUCH_TARGET / 2 },
  gearBtn: {
    width: MIN_TOUCH_TARGET,
    height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    ...shadow.card,
  },

  /* --- Shared card ------------------------------------------------- */
  card: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: CARD_RADIUS,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
  },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 1.3,
    color: colors.inkSoft,
  },
  cardTitle: { flex: 1, fontSize: fontSize.md, fontWeight: '800', color: colors.ink },

  /* --- Daily pulse -------------------------------------------------- */
  pulseHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  pulseCta: {
    minHeight: MIN_TOUCH_TARGET - 12,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    backgroundColor: colors.tealTint,
  },
  pulseCtaText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.tealDeep },

  energyRow: { flexDirection: 'row', marginTop: spacing.sm },
  energyCell: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET + 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  energyDot: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: 'transparent',
  },
  energyName: {
    marginTop: 4,
    fontSize: fontSize.xs,
    fontWeight: '600',
    color: colors.inkSoft,
  },
  scaleCaption: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.inkSoft,
  },

  /* --- Instant recorder --------------------------------------------- */
  recorder: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.lg,
    ...shadow.raised,
  },
  eyebrowOnRed: { color: colors.onMedia, opacity: 0.85 },
  recorderBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.lg,
    backgroundColor: colors.onMediaVeil,
    borderWidth: 1,
    borderColor: colors.onMediaVeilEdge,
  },
  recorderKicker: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.onMedia,
    opacity: 0.9,
  },
  recorderTitle: {
    fontSize: fontSize.md,
    fontWeight: '800',
    color: colors.onMedia,
    marginTop: 2,
  },
  recorderClock: {
    fontSize: fontSize.timer - 8,
    fontWeight: '800',
    color: colors.onMedia,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
  },
  recorderFoot: {
    marginTop: spacing.sm,
    textAlign: 'center',
    fontSize: fontSize.md,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.onMedia,
  },

  /* --- Data dashboard ------------------------------------------------ */
  insights: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.pill,
    backgroundColor: colors.tealTint,
  },
  insightsText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.tealDeep },
  dash: { flexDirection: 'row', gap: spacing.md, marginTop: spacing.md },
  dashLeft: { flex: 1, justifyContent: 'flex-end' },
  spark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 4,
    height: 28,
    marginBottom: spacing.sm,
  },
  sparkTrack: {
    flex: 1,
    height: '100%',
    justifyContent: 'flex-end',
    borderRadius: 3,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  sparkBar: { width: '100%', borderRadius: 2 },
  dashValue: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
  },
  dashLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.inkSoft },
  dashRight: { flex: 1.1, justifyContent: 'center' },
  metricRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: 7,
  },
  metricLabel: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.inkSoft,
    flexShrink: 1,
  },
  metricValue: {
    fontSize: fontSize.base,
    fontWeight: '800',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },
  metricDivider: { height: 1, backgroundColor: colors.line },

  /* --- Sections ------------------------------------------------------ */
  sectionHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.xl,
    marginBottom: spacing.md,
  },
  ruleFlush: { marginTop: 0, marginBottom: 0 },
  seeAll: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingLeft: spacing.sm,
  },
  seeAllText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.tealDeep },

  /* --- Video row ----------------------------------------------------- */
  videoScroll: { marginHorizontal: -spacing.lg },
  videoScrollContent: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    paddingBottom: spacing.xs,
  },
  videoCard: { width: VIDEO_CARD_WIDTH },
  playBadge: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    alignItems: 'center',
    justifyContent: 'center',
  },
  playDisc: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.onMediaScrim,
    // Nudged right: a play triangle's visual centre sits left of its bounding
    // box, so centring the box leaves it looking off-centre in the disc.
    paddingLeft: 3,
  },
  videoTitle: {
    fontSize: fontSize.base,
    fontWeight: '800',
    color: colors.ink,
    marginTop: spacing.sm,
  },
  videoSub: {
    fontSize: fontSize.sm,
    color: colors.inkSoft,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
  },
});
