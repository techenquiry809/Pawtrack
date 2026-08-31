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
 * Tapping one SAVES IMMEDIATELY into today's row, creating it if today has not
 * been logged yet. Everything else on an existing row is left untouched, and
 * tapping again just replaces the value — one record per day, last tap wins,
 * enforced by the unique index rather than by this screen remembering.
 *
 * ── HOW THAT AVOIDS FABRICATING THE CONTROL DATASET ───────────────────
 *
 * It used to only EDIT an existing row and push you to the form otherwise,
 * because `upsertCheckinForDate` writes the WHOLE row — creating one from a
 * single tap would have recorded appetite, water, stress and GI as "normal" on
 * a day the owner never described. That mattered: these rows are the control
 * dataset the seizure analysis measures against, and `stressAssociation` reads
 * a stress rating that would have been invented.
 *
 * Both halves are now handled properly instead of avoided.
 * `checkinRepo.setTodaysEnergy` updates only the energy column on an existing
 * row, and when it has to create one it marks it `mood_only` — meaning the
 * energy is real and nothing else on the row is. Analytics skips those rows
 * for the fields nobody answered, so a tap can never move a figure a vet
 * reads. Filling in the full form later clears the flag.
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
import { MoodFace } from '@/components/MoodFace';
import { ClusterAlert } from '@/components/ClusterAlert';
import { activeCluster } from '@/features/analytics';
import { seizuresPerDay } from '@/features/analytics/daily';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, shadow, spacing } from '@/theme/tokens';
import { useChromeMetrics } from '@/theme/chrome';
import { useActiveDog, useAppStore } from '@/store/appStore';
import { useActiveSeizure } from '@/store/activeSeizureStore';
import { breedDisplay } from '@/db/dogRepo';
import { DogAvatar } from '@/components/ProfileHeader';
import * as seizureRepo from '@/db/seizureRepo';
import * as checkinRepo from '@/db/checkinRepo';
import * as videoRepo from '@/db/videoRepo';
import { formatDuration, localDayKey, startOfDay } from '@/utils/time';
import type { DailyCheckin, GalleryEntry, Seizure } from '@/types/domain';

const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;

/** How many clips the home strip previews before deferring to "See all". */
const VIDEO_PREVIEW_COUNT = 4;

/**
 * Days in the dashboard chart.
 *
 * DAYS, not weeks. This was eight rolling seven-day buckets, unlabelled, which
 * nobody could read as anything in particular — an owner who logged six
 * seizures in one day saw a chart that barely moved, because those six sat
 * inside a single bar alongside the rest of the week. The one number a bad day
 * needs to shout was the one the chart hid.
 *
 * Fourteen is the most bars that stay tappable-wide on the narrowest phone
 * while still showing enough history to see a cluster forming.
 */
const TREND_DAYS = 14;

/** Drawable height of a bar, in points. The track is this plus breathing room. */
const BAR_H = 28;

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

  /**
   * Seizures per CALENDAR day, oldest first, ending today.
   *
   * Bucketed on local midnights rather than on `now - start` in day-sized
   * chunks. The subtraction version drifts: at 09:00 a seizure from yesterday
   * 22:00 is eleven hours ago and lands in "today", so the chart silently
   * disagrees with the record the owner just looked at. Calendar days are also
   * the only definition that makes "six seizures today" a single tall bar.
   */
  const trend = useMemo(
    // The maths lives in features/analytics/daily.ts so it can be tested — it
    // is the arithmetic behind the chart an owner shows their vet, and a chart
    // that quietly files an event on the wrong day is still believed.
    () => seizuresPerDay(seizures.map((s) => s.start), TREND_DAYS),
    [seizures],
  );

  if (!dog) return null;

  const last = seizures[0];
  /** The five most recent, newest first. listSeizuresSince already sorts DESC. */
  const recent = seizures.slice(0, 5);
  // Rolling windows, and the labels below say so. They used to read "This
  // week" and "This month", which people read as calendar periods — on a
  // Monday, "this week: 9" counting last Wednesday's seizure is simply wrong
  // to the person reading it.
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

  /**
   * More than one seizure inside the owner's configured window.
   *
   * `activeCluster` returns only a run whose window is still OPEN — another
   * seizure now would extend the same run. A cluster from last March is
   * history and belongs in the pattern report, not in an alert on the home
   * screen. See src/features/analytics/clusters.ts.
   */
  /**
   * Held back until the load has finished.
   *
   * `seizures` starts empty and is filled by a focus effect, so for the first
   * frames of every visit the list is not the record — it is the absence of
   * one. Deriving the alert from that produced two bad behaviours: a cluster
   * banner that popped in a beat after the screen settled, and, worse, an
   * alert computed from a PARTIAL list while a refresh was in flight.
   *
   * Nothing here is urgent enough to be worth showing early. A count that has
   * to be right is worth waiting a few hundred milliseconds for.
   */
  const cluster = loading
    ? null
    : activeCluster(
        seizures,
        settings.clusterWindowHrs,
        settings.clusterCount,
        now,
      );

  const onRecord = () => {
    if (settings.hapticsEnabled) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    startSeizure(dog.id);
    router.push('/seizure/live');
  };

  /**
   * Save the mood into today's record, straight away.
   *
   * No confirmation and no Save button: the whole point of this row is that
   * logging how the day went costs one tap. See the note at the top of the
   * file for why creating the row is safe now when it was not before.
   */
  const onPickEnergy = async (value: number) => {
    // Nothing to do if they tapped the face that is already selected. Worth
    // checking because the alternative is a pointless write that bumps
    // updated_at and queues a sync push for no change.
    if (checkin?.energy === value) return;

    if (settings.hapticsEnabled) {
      void Haptics.selectionAsync();
    }

    // Optimistic, so the row responds under the finger rather than after a
    // database round trip. `previous` is captured for the rollback below.
    const previous = checkin;
    setCheckin(
      checkin
        ? { ...checkin, energy: value }
        // A placeholder until load() returns the real row. Marked moodOnly so
        // nothing downstream mistakes these defaults for answers even during
        // the few milliseconds it exists.
        : {
            id: '', dogId: dog.id, timestamp: Date.now(),
            checkInDate: localDayKey(), sleepHrs: null,
            appetite: 'normal', water: 'normal', energy: value, stress: 2,
            medOnTime: true, gi: 'none', unusual: '', backfilled: false,
            moodOnly: true, createdAt: Date.now(), updatedAt: Date.now(),
          },
    );

    try {
      await checkinRepo.setTodaysEnergy(dog.id, value);
      // Re-read rather than trusting the optimistic value: the row may have
      // just been created, and it now has a real id the placeholder lacked.
      await load();
    } catch (e) {
      console.error('[home] energy update failed', e);
      setCheckin(previous);
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
            return (
              <MoodFace
                key={step.icon}
                icon={step.icon}
                name={step.name}
                tint={step.tint}
                ink={step.ink}
                solid={step.solid}
                value={value}
                active={checkin?.energy === value}
                onPress={() => void onPickEnergy(value)}
                // Was "Opens the check-in form — nothing is recorded until you
                // finish it", which stopped being true when the tap started
                // saving directly. A stale hint is worse than none: it is the
                // only description a screen-reader user gets of what the
                // control will do, and this one promised nothing would be
                // written.
                accessibilityHint="Records how the day is going, straight away"
              />
            );
          })}
        </View>

        <Text style={styles.scaleCaption}>
          {checkin
            ? `${dog.name} is ${(ENERGY_STEPS[checkin.energy - 1]?.name ?? 'Steady').toLowerCase()} today`
            : 'Not checked in yet — tap a face to start'}
        </Text>
      </View>

      {/*
        Placed ABOVE the recorder and below the daily pulse.
        Not at the very top: the header is who this is. Not below the
        recorder: an owner who opens the app after a bad night must see this
        without scrolling, and the recorder is tall.
      */}
      {cluster && (
        <ClusterAlert
          cluster={cluster}
          dog={dog}
          windowHours={settings.clusterWindowHrs}
          now={now}
        />
      )}

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

      {/*
        The manual path, deliberately quiet and deliberately BELOW the
        recorder.

        The Record card above starts the timer on one tap with no
        confirmation, and that must stay true — a chooser in front of it would
        tax every real seizure to serve the rarer case of logging one from
        memory. So this is a separate, low-emphasis row rather than a second
        option inside the same control.
      */}
      <Pressable
        onPress={() => router.push('/log-seizure')}
        accessibilityRole="button"
        accessibilityLabel="Log a seizure that already happened"
        accessibilityHint="Opens a form to record a past seizure from memory"
        style={({ pressed }) => [styles.logPast, pressed && styles.pressed]}
      >
        <Icon name="edit" size="md" color={colors.inkSoft} />
        <Text style={styles.logPastLabel}>Log one that already happened</Text>
        <Icon name="chevron" size="md" color={colors.inkSoft} />
      </Pressable>

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

        {/*
          ── WHY THIS IS ONE COLUMN NOW ──────────────────────────────────

          It was two: a 14-bar chart squeezed into the left half beside a large
          number, with three metrics stacked in the right half. Neither side had
          the room it needed — the chart is the widest thing on the card and was
          given the least width, and the metrics were a wall of small text
          competing with it for the same glance.

          Full-width chart, then one stat per row. Each row carries an icon, a
          label and a value, so the eye can find a single figure without having
          to read the whole block.
        */}
        <DayBars days={trend} />

        {/*
          Two by two, not four stacked rows.

          The full-width pill rows read well in isolation and made this card
          eat close to half the home screen — on a screen whose whole job is to
          get an owner to the record button fast. Four figures do not need four
          rows: they are short values with short labels, so they pair off and
          the card loses a third of its height without losing a number.
        */}
        <View style={styles.statGrid}>
          <StatCell
            icon="clock"
            label="Most recent"
            value={
              daysSince === null
                ? 'None yet'
                : daysSince === 0
                  ? 'Today'
                  : `${daysSince}d ago`
            }
          />
          <StatCell
            icon="calendar"
            label="Last 7 days"
            value={`${week.length}`}
          />
          <StatCell
            icon="trend"
            label="Last 30 days"
            value={`${month.length}`}
          />
          <StatCell
            icon="timer"
            label="Typical length"
            value={avgDuration === null ? '—' : formatDuration(avgDuration)}
          />
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

      {/* --- Recent seizures --------------------------------------------- */}
      {/*
        Five, not one.
        A single "last seizure" answers "when", which the days-since counter
        above already answers. Five answers the question an owner actually
        brings to this screen: is this getting worse. Spacing between the dates
        is the pattern, and one row cannot show spacing.
      */}
      <SectionRule label={recent.length > 1 ? 'Recent seizures' : 'Last seizure'} />
      {recent.length > 0 ? (
        <Card>
          {recent.map((s, i) => (
            <Pressable
              key={s.id}
              onPress={() => router.push(`/seizure-detail/${s.id}`)}
              accessibilityRole="button"
              accessibilityLabel={`Seizure on ${new Date(s.start).toLocaleDateString()}, tap for detail`}
              style={({ pressed }) => [
                styles.recentRow,
                i === recent.length - 1 && styles.recentRowLast,
                pressed && styles.pressed,
              ]}
            >
              <View style={styles.flexOne}>
                <Body style={styles.semibold}>
                  {new Date(s.start).toLocaleDateString(undefined, {
                    month: 'short',
                    day: 'numeric',
                  })}
                  {', '}
                  {new Date(s.start).toLocaleTimeString(undefined, {
                    hour: 'numeric',
                    minute: '2-digit',
                  })}
                </Body>
                <Muted numberOfLines={1} style={styles.recentObs}>
                  {s.ictalObs.slice(0, 3).join(', ') || 'No observations logged'}
                </Muted>
              </View>
              <Pill
                // Absence of a duration, not low confidence in one — see the
                // note in seizure-detail. The tone still keeps an owner-stated
                // length visually distinct from a measured one.
                label={
                  s.durationSec === null || s.durationSec === 0
                    ? 'Not timed'
                    : formatDuration(s.durationSec)
                }
                tone={
                  s.durationConfidence === 'unreliable' || s.durationSec === 0
                    ? 'neutral'
                    : 'teal'
                }
              />
            </Pressable>
          ))}
        </Card>
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
/**
 * Seizures per day for the last fortnight.
 *
 * ── WHAT WAS WRONG WITH THE OLD CHART ─────────────────────────────────
 *
 * Eight bars, no labels, no scale, and each one silently covered a rolling
 * week. There was no way to learn what a bar meant by looking at it, and the
 * obvious guess — one bar per day, sitting as it does beside "days since
 * last" — was wrong. A owner who logged six seizures in a day saw a chart that
 * barely twitched.
 *
 * ── WHAT MAKES THIS ONE READABLE ──────────────────────────────────────
 *
 * Three things, none of them decoration:
 *
 *   the caption   says what a bar is and how far back the chart goes
 *   the count     printed above any day that had one, so the height is never
 *                 the only carrier of the number — six is legible as SIX, not
 *                 as "taller than the others"
 *   today         marked under the last bar and drawn in the deeper tone, so
 *                 the right-hand end is anchored to a date the owner knows
 *
 * The empty days keep their track. A quiet fortnight is the normal case, and
 * bare bars on a quiet history render as a row of stubs that reads like a
 * dashed line rather than a chart.
 */
function DayBars({ days }: { days: number[] }) {
  const peak = Math.max(1, ...days);
  const total = days.reduce((sum, n) => sum + n, 0);
  const busiest = Math.max(...days);

  return (
    <View style={styles.chartWrap}>
      {/* Titled BEFORE the bars. The caption used to sit under the axis, so a
          reader met fourteen unexplained bars and only learned what they were
          after passing them. */}
      <View style={styles.chartHead}>
        <Text style={styles.chartTitle}>Seizures per day</Text>
        <Text style={styles.chartRange}>Last {days.length} days</Text>
      </View>

      <View
        style={styles.spark}
        accessible
        accessibilityLabel={
          total === 0
            ? `No seizures in the last ${days.length} days`
            : `${total} seizure${total === 1 ? '' : 's'} in the last ${days.length} days. ` +
              `Busiest day had ${busiest}. Today had ${days[days.length - 1] ?? 0}.`
        }
      >
        {days.map((n, i) => {
          const isToday = i === days.length - 1;
          return (
            <View key={i} style={styles.sparkCol}>
              {/* The number, above its bar. Height alone cannot be read as a
                  value, and this is the figure a vet is told. */}
              <Text
                style={[styles.sparkCount, n === 0 && styles.sparkCountOff]}
                numberOfLines={1}
              >
                {n > 0 ? n : '·'}
              </Text>
              {/* Every day keeps a track, so an empty day reads as a recorded
                  zero rather than as missing data. */}
              <View style={styles.sparkTrack}>
                <View
                  style={[
                    styles.sparkBar,
                    {
                      height:
                        n === 0 ? 3 : Math.max(6, Math.round((n / peak) * BAR_H)),
                      backgroundColor:
                        n === 0
                          ? colors.line
                          : isToday
                            ? colors.tealDeep
                            : colors.teal,
                    },
                  ]}
                />
              </View>
            </View>
          );
        })}
      </View>

      <View style={styles.chartAxis}>
        <Text style={styles.axisLabel}>{days.length} days ago</Text>
        <Text style={[styles.axisLabel, styles.axisToday]}>Today</Text>
      </View>
    </View>
  );
}

/**
 * One figure on the dashboard: icon, what it is, and what it says.
 *
 * ── WHY EVERY CIRCLE IS THE SAME COLOUR ───────────────────────────────
 *
 * The reference this row came from tints each stat a different hue — green,
 * purple, red, yellow — as decoration. That is fine on a workout card and
 * wrong here. In this app amber and red already MEAN something: the cluster
 * banner uses red for "call your vet", the calendar uses amber for a missed
 * day. Spending those colours on "last 30 days" would teach the owner that the
 * palette is decorative, on the one screen where a red thing has to read as
 * urgent.
 *
 * So the icon carries the distinction between rows and the tint stays neutral.
 */
/**
 * One figure, sized to sit four-to-a-card.
 *
 * ── WHY EVERY ICON IS THE SAME COLOUR ─────────────────────────────────
 *
 * The reference this came from tints each stat a different hue as decoration.
 * That is fine on a workout card and wrong here: in this app amber and red
 * already MEAN something — the cluster banner uses red for "call your vet",
 * the calendar uses amber for a missed day. Spending those colours on "last 30
 * days" would teach the owner the palette is decorative, on the one screen
 * where a red thing has to read as urgent.
 *
 * The icon distinguishes the rows; the colour stays out of it.
 */
function StatCell({
  icon,
  label,
  value,
}: {
  icon: IconName;
  label: string;
  value: string;
}) {
  return (
    <View style={styles.statCell} accessible accessibilityLabel={`${label}: ${value}`}>
      <View style={styles.statHead}>
        <Icon name={icon} size="sm" color={colors.tealDeep} />
        <Text style={styles.statLabel} numberOfLines={1}>
          {label}
        </Text>
      </View>
      <Text style={styles.statValue} numberOfLines={1}>
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

/*
 * Removed: CARD_RADIUS was a second name for radius.card, and having two names
 * for one value is how a stack of cards drifts apart one edit at a time.
 */
const VIDEO_CARD_WIDTH = 150;

const styles = StyleSheet.create({
  recentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    paddingVertical: spacing.sm,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  recentRowLast: { borderBottomWidth: 0, paddingBottom: 0 },
  flexOne: { flex: 1 },
  recentObs: { marginTop: 1 },
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  flex: { flex: 1 },
  rowBetween: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  semibold: { fontWeight: '600', fontFamily: fontFamily.semibold },
  pressed: { opacity: 0.85 },

  /* --- Header ------------------------------------------------------ */
  header: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  dogName: {
    fontSize: fontSize.display,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.8,
    fontFamily: fontFamily.extrabold
  },
  /*
    Card radius, not control radius. This is a full-width row in a stack of
    cards, and a pill sitting between two 24pt cards was the one container on
    the screen that did not match its neighbours.

    The TIGHT top margin is deliberate and stays: this is the recorder's
    sibling — one action for a seizure happening now, one for a seizure that
    already happened — and the short gap is what groups them into a pair
    instead of leaving them as two unrelated blocks.
  */
  logPast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
    marginTop: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  logPastLabel: {
    flex: 1,
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.inkSoft,
    fontFamily: fontFamily.bold
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
    borderRadius: radius.card,
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
    fontFamily: fontFamily.extrabold
  },
  cardTitle: { flex: 1, fontSize: fontSize.md, fontWeight: '800', color: colors.ink, fontFamily: fontFamily.extrabold },

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
    borderRadius: radius.control,
    backgroundColor: colors.tealTint,
  },
  pulseCtaText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.tealDeep, fontFamily: fontFamily.extrabold },

  energyRow: { flexDirection: 'row', marginTop: spacing.sm },
  scaleCaption: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.inkSoft,
    fontFamily: fontFamily.semibold
  },

  /* --- Instant recorder --------------------------------------------- */
  recorder: {
    marginTop: spacing.lg,
    padding: spacing.md,
    borderRadius: radius.card,
    ...shadow.raised,
  },
  eyebrowOnRed: { color: colors.onMedia, opacity: 0.85 },
  recorderBtn: {
    marginTop: spacing.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
    borderRadius: radius.card,
    backgroundColor: colors.onMediaVeil,
    borderWidth: 1,
    borderColor: colors.onMediaVeilEdge,
  },
  recorderKicker: {
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.onMedia,
    opacity: 0.9,
    fontFamily: fontFamily.semibold
  },
  recorderTitle: {
    fontSize: fontSize.md,
    fontWeight: '800',
    color: colors.onMedia,
    marginTop: 2,
    fontFamily: fontFamily.extrabold
  },
  recorderClock: {
    fontSize: fontSize.timerSm,
    fontWeight: '800',
    color: colors.onMedia,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
    marginTop: 2,
    fontFamily: fontFamily.extrabold
  },
  recorderFoot: {
    marginTop: spacing.sm,
    textAlign: 'center',
    fontSize: fontSize.md,
    fontWeight: '800',
    letterSpacing: 2,
    color: colors.onMedia,
    fontFamily: fontFamily.extrabold
  },

  /* --- Data dashboard ------------------------------------------------ */
  insights: {
    paddingHorizontal: spacing.md,
    paddingVertical: 6,
    borderRadius: radius.control,
    backgroundColor: colors.tealTint,
  },
  insightsText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.tealDeep, fontFamily: fontFamily.extrabold },
  chartWrap: { flex: 1 },
  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginTop: spacing.md,
    rowGap: spacing.md,
  },
  /* Half-width: two per row, four in two rows. */
  statCell: { width: '50%', paddingRight: spacing.sm, gap: 1 },
  statHead: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  statLabel: {
    flex: 1,
    fontSize: fontSize.xs,
    color: colors.inkSoft,
    fontFamily: fontFamily.medium,
  },
  statValue: {
    fontSize: fontSize.md,
    color: colors.ink,
    fontFamily: fontFamily.bold,
    fontVariant: ['tabular-nums'],
  },
  sparkCol: { flex: 1, alignItems: 'center', gap: 3 },
  sparkCount: {
    fontSize: fontSize.xs,
    lineHeight: 14,
    height: 14,
    color: colors.tealDeep,
    fontFamily: fontFamily.bold,
    fontVariant: ['tabular-nums'],
  },
  /* A quiet day keeps a dot rather than a number: the row of counts stays a
     row, so the eye reads the busy days as spikes in a rhythm. */
  sparkCountOff: { color: colors.line, fontFamily: fontFamily.regular },
  chartHead: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  chartTitle: {
    fontSize: fontSize.base,
    color: colors.ink,
    fontFamily: fontFamily.semibold,
  },
  chartRange: {
    fontSize: fontSize.xs,
    color: colors.inkSoft,
    fontFamily: fontFamily.regular,
  },
  chartAxis: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginTop: 5,
  },
  axisLabel: { fontSize: fontSize.xs, color: colors.inkSoft, fontFamily: fontFamily.regular },
  axisToday: { color: colors.tealDeep, fontFamily: fontFamily.semibold },
  /*
    The bug this replaced: `spark` was 28pt tall and each column now holds a
    count label AND a track. The label ate the height and the track — which
    also had `flex: 1` fighting `height: '100%'` inside a column — collapsed to
    nothing, so the chart rendered as a row of floating numbers with no bars.

    Explicit heights all the way down now, and no flex/height conflict.
  */
  spark: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 3,
    marginTop: spacing.sm,
  },
  sparkTrack: {
    width: '100%',
    height: BAR_H,
    justifyContent: 'flex-end',
    borderRadius: 3,
    backgroundColor: colors.bg,
    overflow: 'hidden',
  },
  sparkBar: { width: '100%', borderRadius: 2 },

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
  seeAllText: { fontSize: fontSize.sm, fontWeight: '800', color: colors.tealDeep, fontFamily: fontFamily.extrabold },

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
    // A CIRCLE: half of 34. Not a step on the radius scale — snapping
    // this to a token turns the circle into a rounded square.
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
    fontFamily: fontFamily.extrabold
  },
  videoSub: {
    fontSize: fontSize.sm,
    color: colors.inkSoft,
    marginTop: 1,
    fontVariant: ['tabular-nums'],
    fontFamily: fontFamily.regular
  },
});
