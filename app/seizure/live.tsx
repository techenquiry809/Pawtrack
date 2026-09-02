/**
 * LIVE SEIZURE SCREEN — the emergency interface.
 *
 * Layout hierarchy is deliberate:
 *   PINNED TOP     timer, threshold track, banners, RECORD VIDEO
 *   SCROLL         quick-tap observation chips
 *   PINNED BOTTOM  end-seizure button
 *   SCROLL END     emergency contacts
 *
 * Nothing on this screen requires typing.
 *
 * ── WHAT THE REDESIGN CHANGED, AND WHY ────────────────────────────────
 *
 * 1. "SEIZURE ENDED" IS PINNED. It used to sit below four chip groups —
 *    roughly two scrolls down. The owner needs that button at the exact
 *    unpredictable moment the seizure stops, and asking them to scroll for it
 *    puts a scroll gesture between the event and its recorded end time. That
 *    is a measurement error with a UI cause.
 *
 * 2. THE TIMER HAS A TRACK. A number alone does not say "you are 40 seconds
 *    from the threshold your vet told you about". The track fills toward the
 *    warn mark and then the critical mark, so position is readable at a glance
 *    by someone too distressed to do arithmetic.
 *
 * 3. ONE LABEL SYSTEM. There used to be two all-caps label styles at nearly
 *    the same size — no hierarchy at all. See components/form.tsx.
 *
 * 4. THE CHIP GROUPS MOVED OUT to components/ObservationFields.tsx, shared
 *    with the post screen and the import flow.
 *
 * 5. EMERGENCY CONTACTS STAY LAST. That was right and is unchanged: they must
 *    not compete with the timer, and they remain one scroll away.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Alert, Linking, Pressable, ScrollView, StyleSheet, Text, TextInput, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Muted, Pill } from '@/components/ui';
import { ActionBar, SectionRule } from '@/components/form';
import { Icon } from '@/components/Icon';
import {
  IctalFields,
  type MultiField,
  type ObservationValue,
  type SingleField,
  type TextField,
} from '@/components/ObservationFields';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, spacing } from '@/theme/tokens';
import { useActiveDog, useAppStore } from '@/store/appStore';
import { useActiveSeizure } from '@/store/activeSeizureStore';
import { useSeizureTimer } from '@/hooks/useSeizureTimer';
import { deleteVideoAssets, recordSeizureVideo } from '@/services/videoService';
import * as seizureRepo from '@/db/seizureRepo';
import { formatClock } from '@/utils/time';

export default function LiveSeizureScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dog = useActiveDog();
  const settings = useAppStore((s) => s.settings);

  const draft = useActiveSeizure((s) => s.draft);
  const toggleMulti = useActiveSeizure((s) => s.toggleMulti);
  const setSingle = useActiveSeizure((s) => s.setSingle);
  const setField = useActiveSeizure((s) => s.setField);
  const addVideo = useActiveSeizure((s) => s.addVideo);
  const endSeizure = useActiveSeizure((s) => s.endSeizure);
  const cancel = useActiveSeizure((s) => s.cancel);

  const [clusterCount, setClusterCount] = useState(0);
  const [recording, setRecording] = useState(false);

  // Falls back to the mount time so the hooks below keep a stable argument if
  // the draft is momentarily null (e.g. mid-discard). Must NOT be `Date.now()`
  // inline — that changes every render and restarts the timer's interval.
  const [mountedAt] = useState(() => Date.now());
  const startedAt = draft?.startedAt ?? mountedAt;
  const { elapsed, level } = useSeizureTimer({
    startedAt,
    warnMinutes: settings.thresholdWarnMin,
    criticalMinutes: settings.thresholdCritMin,
    hapticsEnabled: settings.hapticsEnabled,
  });

  // Check for a possible cluster once, when the screen mounts.
  // Depend on the primitive start time, NOT on `draft` — the draft object is
  // replaced on every chip tap, which would re-run this query dozens of times
  // during a seizure.
  const dogId = dog?.id;
  useEffect(() => {
    if (!dogId) return;
    let cancelled = false;
    seizureRepo
      .countSeizuresInWindow(dogId, startedAt, settings.clusterWindowHrs)
      .then((n) => {
        if (!cancelled) setClusterCount(n);
      })
      .catch((e) => console.error('[live] cluster check failed', e));
    return () => {
      cancelled = true;
    };
  }, [dogId, startedAt, settings.clusterWindowHrs]);

  const pendingVideos = draft?.pendingVideos;

  /* -------------------------------------------------------------- */

  const value: ObservationValue | null = useMemo(
    () =>
      draft
        ? {
            ictalObs: draft.ictalObs,
            awareness: draft.awareness,
            autonomic: draft.autonomic,
            position: draft.position,
            preIctalObs: draft.preIctalObs,
            preIctalNote: draft.preIctalNote,
            postBehavior: draft.postBehavior,
            severityOwner: draft.severityOwner,
            notes: draft.notes,
          }
        : null,
    [draft],
  );

  const handlers = useMemo(
    () => ({
      toggle: (field: MultiField, option: string) => toggleMulti(field, option),
      setSingle: (field: SingleField, option: string | null) =>
        setSingle(field, option),
      setText: (field: TextField, text: string) => setField(field, text),
    }),
    [toggleMulti, setSingle, setField],
  );

  const onCancel = useCallback(() => {
    const videoCount = pendingVideos?.length ?? 0;
    Alert.alert(
      'Discard this recording?',
      videoCount > 0
        ? `The timer will stop, and the ${videoCount} video${videoCount === 1 ? '' : 's'} you recorded will be deleted. Nothing will be saved.`
        : 'The timer will stop and nothing will be saved.',
      [
        { text: 'Keep timing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            // Videos were copied into permanent app storage the moment they
            // were captured. Discarding the seizure has to remove them too, or
            // they sit on the phone forever with no record pointing at them
            // and no screen that can delete them.
            for (const video of pendingVideos ?? []) {
              deleteVideoAssets(video);
            }
            cancel();
            router.replace('/(tabs)');
          },
        },
      ],
    );
  }, [cancel, router, pendingVideos]);

  const onRecordVideo = async () => {
    setRecording(true);
    try {
      const video = await recordSeizureVideo();
      if (video) {
        addVideo({
          fileUri: video.fileUri,
          thumbUri: video.thumbUri,
          // capturedAt is measured for a live capture and null only for an
          // import, which cannot reach this screen. The fallback exists so the
          // types line up, not because it is expected to fire.
          timestamp: video.capturedAt ?? Date.now(),
          durationSec: video.durationSec,
        });
      }
    } catch (e) {
      Alert.alert(
        'Could not record video',
        e instanceof Error ? e.message : 'Please try again, or add a video later from Records.',
      );
    } finally {
      setRecording(false);
    }
  };

  const callVet = async (kind: 'vet' | 'emergencyVet') => {
    const phone = dog?.[kind]?.phone?.trim();
    if (!phone) {
      Alert.alert(
        'No phone number saved',
        "Add your veterinarian's number in the Emergency Plan so this button can call them.",
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Add number', onPress: () => router.push('/emergency-plan') },
        ],
      );
      return;
    }
    // Do NOT gate this on Linking.canOpenURL: on Android 11+ it returns false
    // for `tel:` unless the app declares a <queries> intent, which would make
    // the emergency-vet button silently refuse to dial. Attempt the call and
    // only report a failure if the OS actually rejects it.
    try {
      await Linking.openURL(`tel:${phone}`);
    } catch {
      Alert.alert(
        'Could not start the call',
        `Dial ${phone} from your phone app.`,
      );
    }
  };

  if (!draft || !dog || !value) {
    // Defensive: if the store was cleared out from under us, get back to safety.
    return null;
  }

  // Cluster warning counts this seizure plus any already inside the window.
  const isPossibleCluster = clusterCount + 1 >= settings.clusterCount;
  const videoCount = draft.pendingVideos.length;

  return (
    <View
      style={[
        styles.screen,
        level === 'critical' && { backgroundColor: colors.redTint },
      ]}
    >
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md },
        ]}
      >
        {/* --- Recording card ---------------------------------------
            Status, timer, elapsed-since and the threshold track are ONE
            surface. They were four elements floating on the background, which
            left the most important number on the screen looking like a caption
            between two controls. The card also gives the threshold state
            somewhere to go: it tints amber at the warn mark and red at the
            critical one, so the screen changes at a glance from across a room
            rather than only in the small print of a banner. */}
        <View
          style={[
            styles.timerCard,
            level === 'warn' && styles.timerCardWarn,
            level === 'critical' && styles.timerCardCrit,
          ]}
        >
          <View style={styles.header}>
            <Pill label="● Recording" tone="red" />
            <Pressable
              onPress={onCancel}
              accessibilityRole="button"
              accessibilityLabel="Discard this seizure recording"
              style={({ pressed }) => [styles.closeBtn, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.closeIcon}>✕</Text>
            </Pressable>
          </View>

          <View
            style={styles.timerWrap}
            accessible
            accessibilityLabel={`Seizure timer, ${Math.floor(elapsed / 60)} minutes ${elapsed % 60} seconds elapsed`}
            accessibilityLiveRegion="polite"
          >
            <Text
              style={[
                styles.timer,
                level === 'warn' && { color: colors.amberInk },
                level === 'critical' && { color: colors.redDeep },
              ]}
            >
              {formatClock(elapsed)}
            </Text>
            <Muted style={styles.timerCaption}>
              {dog.name} · started{' '}
              {new Date(draft.startedAt).toLocaleTimeString(undefined, {
                hour: 'numeric', minute: '2-digit', second: '2-digit',
              })}
            </Muted>
          </View>

          <ThresholdTrack
            elapsed={elapsed}
            warnMinutes={settings.thresholdWarnMin}
            criticalMinutes={settings.thresholdCritMin}
            level={level}
          />
        </View>

        {/* --- Threshold banners ------------------------------------- */}
        {level === 'warn' && (
          <View style={[styles.banner, styles.bannerWarn]}>
            <Text style={styles.bannerIcon}>⚠</Text>
            <Body style={styles.bannerWarnText}>
              Seizure has lasted {settings.thresholdWarnMin} minutes. Continue
              timing and follow your veterinarian&apos;s emergency plan.
            </Body>
          </View>
        )}
        {level === 'critical' && (
          <View style={[styles.banner, styles.bannerCrit]}>
            <Text style={styles.bannerIcon}>⚠</Text>
            <Body style={styles.bannerCritText}>
              Seizure has reached {settings.thresholdCritMin} minutes. This may
              be a veterinary emergency. Contact an emergency veterinarian
              immediately.
            </Body>
          </View>
        )}
        {isPossibleCluster && (
          <View style={[styles.banner, styles.bannerWarn]}>
            <Text style={styles.bannerIcon}>⚠</Text>
            <Body style={styles.bannerWarnText}>
              This may be seizure #{clusterCount + 1} within{' '}
              {settings.clusterWindowHrs} hours — possible cluster seizures.
              Consider contacting your veterinarian.
            </Body>
          </View>
        )}

        {/* --- Record video (high priority, above the fold) ----------
            NOT red any more. Red on this screen belongs to one control — the
            pinned "Seizure ended" button — and a second full-width red button
            directly above it made the two compete at the moment the owner can
            least afford to read carefully. This is the secondary action: still
            full width, still above the fold, but visibly not the stop button.
            Its subtitle carries the safety caveat and the clip count in the
            same slot, so the row does not change height when the first clip
            lands. */}
        <Pressable
          onPress={() => void onRecordVideo()}
          disabled={recording}
          accessibilityRole="button"
          accessibilityLabel={recording ? 'Opening camera' : 'Record video'}
          accessibilityHint="Opens the camera to record this seizure"
          accessibilityState={{ disabled: recording }}
          style={({ pressed }) => [
            styles.videoBtn,
            pressed && { opacity: 0.85 },
            recording && { opacity: 0.6 },
          ]}
        >
          <View style={styles.videoGlyph}>
            <Icon name="camera" size="lg" color={colors.redDeep} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.videoBtnLabel}>
              {recording ? 'Opening camera…' : 'Record video'}
            </Text>
            <Text style={styles.videoBtnSub} numberOfLines={1}>
              {videoCount > 0
                ? `${videoCount} clip${videoCount === 1 ? '' : 's'} saved with this record`
                : 'Only if it is safe to do so'}
            </Text>
          </View>
          {videoCount > 0 ? (
            <Pill label={String(videoCount)} tone="teal" />
          ) : null}
        </Pressable>

        {/* --- Quick note -------------------------------------------
            Collapsed by default and deliberately BELOW the video button.

            This screen does one thing, and the pinned "Seizure ended" control
            is the only thing that must be reachable without thought. A text
            field open by default would put a keyboard over a running timer.

            But the observations are otherwise collected two screens later, on
            the post-seizure form — by which point they are being recalled
            rather than watched. An owner who wants to type "paddling, left
            side" while they can still see it should not have to remember it
            for four minutes.

            Writes through setField('notes'), which the store already debounces
            into the same durable row as every other field. Nothing here is
            held only in component state. */}
        <QuickNote
          value={draft.notes}
          onChange={(text) => setField('notes', text)}
        />

        {/* --- Observations ------------------------------------------ */}
        <SectionRule label="Quick observations — all optional" />
        <IctalFields value={value} on={handlers} />

        <Muted style={styles.safetyNote}>
          Your and your dog&apos;s safety come first. Avoid touching the mouth
          or restraining your dog during a seizure.
        </Muted>

        {/* --- Emergency contacts (bottom, by design) ---------------- */}
        <SectionRule label="Emergency contacts" />
        <View style={styles.callRow}>
          <Button
            label="Emergency vet"
            variant="danger"
            onPress={() => callVet('emergencyVet')}
            style={styles.flex}
          />
          <Button
            label="Primary vet"
            variant="ghost"
            onPress={() => callVet('vet')}
            style={styles.flex}
          />
        </View>
        <Button
          label="View emergency plan"
          variant="ghost"
          onPress={() => router.push('/emergency-plan')}
          style={{ marginTop: spacing.sm }}
        />
      </ScrollView>

      {/* --- The one button that must never need scrolling for ------- */}
      <ActionBar bottomInset={insets.bottom}>
        <Button
          label="Seizure ended — stop timer"
          variant="danger"
          large
          onPress={() => {
            endSeizure();
            router.replace('/seizure/post');
          }}
          accessibilityHint="Stops the timer and records the end time"
        />
      </ActionBar>
    </View>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Elapsed time against the owner's OWN thresholds.
 *
 * Scaled so the critical mark sits at 80% of the track, leaving visible room
 * beyond it — a bar that pins at 100% the moment it turns red stops conveying
 * anything at exactly the point the information matters most.
 *
 * The marks are labelled in minutes because the thresholds are configured in
 * minutes; converting them to a fraction of an unlabelled bar would ask the
 * owner to do arithmetic they cannot do right now.
 */
function ThresholdTrack({
  elapsed,
  warnMinutes,
  criticalMinutes,
  level,
}: {
  elapsed: number;
  warnMinutes: number;
  criticalMinutes: number;
  level: 'none' | 'warn' | 'critical';
}) {
  const criticalSec = Math.max(1, criticalMinutes * 60);
  const fullScaleSec = criticalSec / 0.8;

  // The return type is the template-literal form React Native's DimensionValue
  // requires. A plain `string` is rejected — RN 0.86 narrowed percentages to
  // `${number}%` so a typo like '50px' cannot reach a native layout prop.
  const pct = (seconds: number): `${number}%` =>
    `${Math.min(100, Math.max(0, (seconds / fullScaleSec) * 100))}%`;

  const fillColor =
    level === 'critical' ? colors.red : level === 'warn' ? colors.amber : colors.teal;

  return (
    <View
      style={styles.track}
      accessibilityElementsHidden
      importantForAccessibility="no"
    >
      <View style={styles.trackRail}>
        <View
          style={[styles.trackFill, { width: pct(elapsed), backgroundColor: fillColor }]}
        />
        <View style={[styles.trackMark, { left: pct(warnMinutes * 60) }]} />
        <View
          style={[
            styles.trackMark,
            styles.trackMarkCritical,
            { left: pct(criticalSec) },
          ]}
        />
      </View>
      {/*
        Each label is pinned under its OWN mark, using the same pct() the mark
        uses. A space-between row put them at 0% and 100% instead, so with the
        default 2/5 minute thresholds the marks sat at 32% and 80% while their
        labels sat at the two ends — and "5 min" at the far right of a track
        that actually runs to 6:15 states the wrong full scale, which is the one
        thing this control exists to communicate.
      */}
      <View style={styles.trackLabels}>
        <Text style={[styles.trackLabel, { left: pct(warnMinutes * 60) }]}>
          {warnMinutes} min
        </Text>
        <Text
          style={[
            styles.trackLabel,
            styles.trackLabelCritical,
            { left: pct(criticalSec) },
          ]}
        >
          {criticalMinutes} min
        </Text>
      </View>
    </View>
  );
}

/**
 * A note the owner can add while the seizure is happening.
 *
 * Starts as a single low-emphasis row. Tapping it reveals the field, and the
 * row then shows a preview of what was typed so the state is legible without
 * opening it again.
 *
 * `blurOnSubmit` with a Done key rather than a multiline free-for-all: the
 * point is a phrase, not a paragraph, and the keyboard has to be dismissible
 * one-handed while holding a phone over a convulsing dog.
 */
function QuickNote({
  value,
  onChange,
}: {
  value: string;
  onChange: (text: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (!open) {
    return (
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={value ? 'Edit your note' : 'Add a note'}
        accessibilityHint="Saved with this seizure record"
        style={({ pressed }) => [styles.noteRow, pressed && { opacity: 0.85 }]}
      >
        <Icon name="edit" size="md" color={colors.inkSoft} />
        <Text style={styles.noteRowLabel} numberOfLines={1}>
          {value.trim() ? value.trim() : 'Add a note'}
        </Text>
      </Pressable>
    );
  }

  return (
    <View style={styles.noteOpen}>
      <TextInput
        value={value}
        onChangeText={onChange}
        placeholder="What are you seeing? e.g. paddling, left side"
        placeholderTextColor={colors.inkSoft}
        style={styles.noteInput}
        autoFocus
        multiline
        maxLength={1000}
        returnKeyType="done"
        blurOnSubmit
        onSubmitEditing={() => setOpen(false)}
        accessibilityLabel="Note for this seizure"
      />
      <Pressable
        onPress={() => setOpen(false)}
        accessibilityRole="button"
        accessibilityLabel="Done writing the note"
        hitSlop={10}
        style={styles.noteDone}
      >
        <Text style={styles.noteDoneLabel}>Done</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  noteRow: {
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
  noteRowLabel: { flex: 1, fontSize: fontSize.base, color: colors.inkSoft, fontFamily: fontFamily.regular },
  noteOpen: {
    marginTop: spacing.sm,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.teal,
    backgroundColor: colors.card,
    padding: spacing.md,
  },
  noteInput: {
    minHeight: 64,
    fontSize: fontSize.base,
    color: colors.ink,
    textAlignVertical: 'top',
    fontFamily: fontFamily.regular
  },
  noteDone: { alignSelf: 'flex-end', paddingTop: spacing.sm },
  noteDoneLabel: { fontSize: fontSize.base, fontWeight: '800', color: colors.teal, fontFamily: fontFamily.extrabold },
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeBtn: {
    // Full 48pt: this is the discard control on the emergency screen, and it is
    // tapped by someone whose hands are not steady.
    width: MIN_TOUCH_TARGET, height: MIN_TOUCH_TARGET,
    borderRadius: MIN_TOUCH_TARGET / 2,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  closeIcon: { fontSize: 18, color: colors.ink, fontFamily: fontFamily.regular },

  /**
   * The recording surface. It carries the threshold state as a fill, so the
   * screen changes colour at the warn and critical marks from across a room —
   * not only inside the small print of a banner.
   */
  timerCard: {
    marginTop: spacing.sm,
    padding: spacing.md,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  timerCardWarn: { backgroundColor: colors.amberTint, borderColor: colors.amber },
  timerCardCrit: { backgroundColor: colors.redTint, borderColor: colors.red },

  videoBtn: {
    marginTop: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET + 16,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  videoGlyph: {
    width: 40,
    height: 40,
    // A CIRCLE: half of 40. Not a step on the radius scale — snapping
    // this to a token turns the circle into a rounded square.
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.redTint,
  },
  videoBtnLabel: { fontSize: fontSize.md, fontWeight: '800', color: colors.ink, fontFamily: fontFamily.extrabold },
  videoBtnSub: { fontSize: fontSize.sm, color: colors.inkSoft, marginTop: 1, fontFamily: fontFamily.regular },

  timerWrap: { alignItems: 'center', marginTop: spacing.lg },
  timer: {
    fontSize: fontSize.timerLg,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'], // stops the digits jittering each second
    letterSpacing: -1,
    fontFamily: fontFamily.bold
  },
  timerCaption: { marginTop: 4, textAlign: 'center' },

  track: { marginTop: spacing.md },
  trackRail: {
    height: 8,
    borderRadius: 4,
    backgroundColor: colors.line,
    overflow: 'hidden',
    justifyContent: 'center',
  },
  trackFill: { position: 'absolute', left: 0, top: 0, bottom: 0, borderRadius: 4 },
  trackMark: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    width: 2,
    backgroundColor: colors.amberInk,
    opacity: 0.55,
  },
  trackMarkCritical: { backgroundColor: colors.redDeep, opacity: 0.75 },
  // A fixed-height positioning context: the labels inside are absolute, so the
  // row has no content to derive a height from.
  trackLabels: { height: fontSize.xs + 4, marginTop: 5 },
  trackLabel: {
    position: 'absolute',
    // Centres the label on its mark rather than starting at it.
    transform: [{ translateX: '-50%' }],
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.inkSoft,
    fontVariant: ['tabular-nums'],
  },
  trackLabelCritical: { color: colors.redDeep },

  banner: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.card,
    padding: spacing.md,
    marginTop: spacing.md,
    alignItems: 'flex-start',
  },
  bannerIcon: { fontSize: fontSize.md, fontFamily: fontFamily.regular },
  bannerWarn: { backgroundColor: colors.amberTint },
  bannerWarnText: { color: colors.amberInk, flex: 1, fontWeight: '600', fontFamily: fontFamily.semibold },
  bannerCrit: { backgroundColor: colors.red },
  bannerCritText: { color: '#fff', flex: 1, fontWeight: '700', fontFamily: fontFamily.bold },

  safetyNote: { textAlign: 'center', marginTop: spacing.xl },

  callRow: { flexDirection: 'row', gap: spacing.sm },
});
