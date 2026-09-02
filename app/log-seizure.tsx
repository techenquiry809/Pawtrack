/**
 * Log a seizure that already happened.
 *
 * ── WHY THIS IS NOT BEHIND THE RECORD BUTTON ──────────────────────────
 *
 * The obvious design is to make "Record seizure" ask "now, or one from
 * earlier?". That would be wrong, and the home screen says why: the recorder
 * starts the timer on a single tap with no confirmation, because a
 * confirmation step costs seconds during an emergency and adds nothing.
 * Putting a chooser in front of it would tax every real seizure to serve the
 * rarer case.
 *
 * So this is a separate, quieter entry point sitting under the recorder. The
 * emergency path is untouched.
 *
 * ── WHY IT IS NOT IN THE seizure/ STACK ───────────────────────────────
 *
 * That stack disables back gestures and suspends sync, both correct for a
 * live capture and both wrong here. Nothing about filling in a form from
 * memory is an emergency, so this is an ordinary deep page with an ordinary
 * way out.
 *
 * ── WHAT IT REFUSES TO CLAIM ──────────────────────────────────────────
 *
 * Everything entered here is recollection, and the record says so:
 * `retrospective: true`, `timingConfidence` at best 'approximate', and
 * `durationConfidence: 'unreliable'` — never 'high', which is reserved for a
 * duration the app's own stopwatch measured. The analytics engine and the vet
 * report both read those flags, so a remembered ninety seconds can never be
 * averaged in as though it had been timed.
 *
 * The DATE is the only required answer. A clock time is welcome but optional —
 * an owner who came home to a seizure, or slept through the start of one, has
 * no hour to give, and the record they can still file beats the one they
 * abandon. A blank time files the seizure at the start of that day and drops
 * `timingConfidence` to 'unknown'.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';

import { Body, Button, Card, Muted } from '@/components/ui';
import { QuestionLabel, TextArea } from '@/components/form';
import { StepShell } from '@/components/StepShell';
import { DateTimeField } from '@/components/DateTimeField';
import {
  AutonomicField,
  AwarenessField,
  MovementField,
  PositionField,
  PostBehaviorField,
  PreIctalField,
  SeverityField,
  EMPTY_OBSERVATIONS,
  type MultiField,
  type ObservationValue,
  type SingleField,
  type TextField,
} from '@/components/ObservationFields';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, spacing } from '@/theme/tokens';
import { useActiveDog } from '@/store/appStore';
import * as seizureRepo from '@/db/seizureRepo';
import * as videoRepo from '@/db/videoRepo';
import {
  importVideos, importVideosFromFiles, thumbnailUri, type CapturedVideo,
} from '@/services/videoService';
import { Icon } from '@/components/Icon';
import { goBackOrHome } from '@/utils/nav';
import { formatDuration } from '@/utils/time';

/** Six hours, matching MAX_PLAUSIBLE_SEIZURE_SECONDS in utils/clock. */
const MAX_SECONDS = 6 * 60 * 60;

export default function LogSeizureScreen() {
  const router = useRouter();
  const dog = useActiveDog();

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  // False when the owner gave a date but no clock time. `startedAt` is then the
  // start of that day, and the record must say so rather than pass midnight off
  // as an observation.
  const [timeKnown, setTimeKnown] = useState(true);
  const [durationKnown, setDurationKnown] = useState(true);
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');
  const [notes, setNotes] = useState('');

  const [obs, setObs] = useState<ObservationValue>(EMPTY_OBSERVATIONS);

  const handlers = useMemo(
    () => ({
      toggle: (field: MultiField, option: string) =>
        setObs((prev) => {
          const list = prev[field];
          return {
            ...prev,
            [field]: list.includes(option)
              ? list.filter((v) => v !== option)
              : [...list, option],
          };
        }),
      setSingle: (field: SingleField, option: string | null) =>
        setObs((prev) => ({ ...prev, [field]: option })),
      setText: (field: TextField, text: string) =>
        setObs((prev) => ({ ...prev, [field]: text })),
    }),
    [],
  );

  const durationSec = useMemo(() => {
    if (!durationKnown) return null;
    const m = Number(minutes || '0');
    const s = Number(seconds || '0');
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    const total = Math.round(m * 60 + s);
    if (total <= 0 || total > MAX_SECONDS) return null;
    return total;
  }, [durationKnown, minutes, seconds]);

  const durationError = (() => {
    if (!durationKnown || (!minutes && !seconds)) return null;
    const total = Math.round(Number(minutes || '0') * 60 + Number(seconds || '0'));
    if (total <= 0) {
      return 'A zero-second seizure is a mis-tap. Leave it blank if you are not sure.';
    }
    if (total > MAX_SECONDS) return 'That is longer than six hours. Check the minutes.';
    return null;
  })();

  // The date is the only thing genuinely required. Everything else — the
  // clock time included — can be blank: a record that says "it happened on
  // Tuesday and I did not note anything else" is still worth far more than no
  // record.
  const canSave =
    dog !== null &&
    startedAt !== null &&
    !durationError &&
    (!durationKnown || durationSec !== null || (!minutes && !seconds));

  /**
   * Clips to attach, chosen before the record exists.
   *
   * Held in memory until save rather than attached as they are picked: a video
   * row needs a seizure_id, and the seizure is not written until the form is
   * submitted. Picking first and attaching after is what lets the video be
   * genuinely optional — nothing is created if the owner backs out.
   */
  const [videos, setVideos] = useState<CapturedVideo[]>([]);
  const [picking, setPicking] = useState(false);
  const [step, setStep] = useState(0);

  const pickFrom = useCallback(
    async (source: 'photos' | 'files') => {
      setPicking(true);
      try {
        const picked = source === 'photos'
          ? await importVideos({ multiple: true })
          : await importVideosFromFiles({ multiple: true });
        if (picked.length > 0) setVideos((prev) => [...prev, ...picked]);
      } catch (e) {
        console.error('[log-seizure] video pick failed', e);
        setError(e instanceof Error ? e.message : 'Could not open your videos.');
      } finally {
        setPicking(false);
      }
    },
    [],
  );

  /**
   * Asks WHERE the clip is before opening a picker.
   *
   * The two pickers read different storage and the owner cannot tell from here
   * which one holds their footage. A clip a vet emailed back, or one saved out
   * of a messaging app, is in Files and simply does not appear in the photo
   * library — so a single "add a video" button that only opened Photos would
   * look, to that owner, like the app refusing their video.
   */
  const onAddVideo = useCallback(() => {
    if (picking) return;
    Alert.alert('Add a video', 'Where is the clip saved?', [
      { text: 'Photo Library', onPress: () => void pickFrom('photos') },
      { text: 'Files', onPress: () => void pickFrom('files') },
      { text: 'Cancel', style: 'cancel' },
    ]);
  }, [picking, pickFrom]);

  const onSave = useCallback(async () => {
    if (!dog || startedAt === null) return;
    setSaving(true);
    setError(null);
    try {
      const known = durationKnown && durationSec !== null;

      const seizureId = await seizureRepo.createSeizure({
        dogId: dog.id,
        start: startedAt,
        end: known ? startedAt + durationSec * 1000 : null,
        durationSec: known ? durationSec : 0,
        // 'approximate' when the owner gave a time and a length, 'unknown'
        // when either is missing — a start stamped at the top of the day
        // because no time was given is not an approximation of anything.
        // Never 'exact': that is reserved for a seizure the app measured.
        timingConfidence: timeKnown && known ? 'approximate' : 'unknown',
        // Deliberately NOT 'high'. Only the in-app stopwatch earns that.
        durationConfidence: 'unreliable',
        retrospective: true,
        preIctalObs: obs.preIctalObs,
        preIctalNote: obs.preIctalNote,
        ictalObs: obs.ictalObs,
        awareness: obs.awareness,
        autonomic: obs.autonomic,
        position: obs.position,
        postBehavior: obs.postBehavior,
        severityOwner: obs.severityOwner,
        recoveryStart: null,
        recoveryEnd: null,
        recoverySec: null,
        // The eight context fields are collected in the live flow's post
        // screen, not here. Asking someone recalling last Tuesday what the
        // weather and the exercise had been is how a form gets abandoned —
        // and a guessed context entry is worse than an empty one, because
        // the analytics engine reads these.
        context: {
          food: '', sleep: '', exercise: '', medication: '',
          stress: '', environment: '', illness: '', exposure: '',
        },
        notes: notes.trim(),
      });

      /*
        Attached after the record exists, and never allowed to sink it.
        The seizure row is the clinical record; a clip that fails to attach is
        a lost attachment, not a lost seizure. Same rule as add-video.tsx and
        the live flow's save.
      */
      let failed = 0;
      for (const video of videos) {
        try {
          await videoRepo.attachVideo({
            seizureId,
            source: 'uploaded',
            fileUri: video.fileUri,
            thumbUri: video.thumbUri,
            // The picker cannot give a reliable capture date, so the clip is
            // stamped with the time the OWNER said the seizure happened and
            // marked owner_stated, rather than inventing a moment.
            timestamp: startedAt,
            importedAt: Date.now(),
            captureConfidence: 'owner_stated',
            durationSec: video.durationSec,
            note: '',
          });
        } catch (e) {
          failed += 1;
          console.error('[log-seizure] could not attach video', e);
        }
      }
      if (failed > 0) {
        Alert.alert(
          failed === videos.length ? 'Videos not attached' : 'Some videos not attached',
          `The seizure was saved. ${failed} ${failed === 1 ? 'video' : 'videos'} could not be attached — you can add ${failed === 1 ? 'it' : 'them'} from the record.`,
        );
      }
      goBackOrHome(router);
    } catch (e) {
      console.error('[log-seizure] save failed', e);
      setError('Could not save this record. Please try again.');
      setSaving(false);
    }
  }, [dog, startedAt, timeKnown, durationKnown, durationSec, obs, notes, videos, router]);

  if (!dog) return null;

  /**
   * Eight steps, from what used to be one scroll of eleven question groups.
   *
   * The order is the order the owner remembers in, not the order the database
   * stores in: the video first (they came here because of it), then when and
   * how long, then the seizure itself front to back, then anything left over.
   *
   * Nothing is required except the date — not even the time — and it is
   * checked on its own step so the owner cannot reach the end and be told to
   * go back.
   */
  /*
   * THREE STEPS, NOT EIGHT.
   *
   * The original flow asked one thing per screen — video, date, duration,
   * movement, awareness, autonomic, before/after, notes. Every question is
   * optional, so seven of those eight screens could be answered by pressing
   * Next, and an owner logging a seizure from memory had to press Next eight
   * times to record two facts. A step is only worth its screen when it asks
   * something that needs its own decision; "here is a chip row you may skip"
   * does not.
   *
   * They are grouped by WHEN the owner knows the answer rather than by field:
   *
   *   1  THE FACTS      the clip, the date, how long — what someone remembers
   *                     immediately, and the only step with a required field.
   *   2  WHAT YOU SAW   the observation chips, all of them, one screen.
   *   3  AROUND IT      before, after, how it looked, notes. Then save.
   *
   * Step 1 is deliberately sized to fit without scrolling: it is the step that
   * carries the one thing the record cannot do without (the date), and a
   * required field below the fold is how a form gets abandoned.
   */
  const STEP_DEFS = [
    // Kept to ONE line on a narrow phone. At two lines the title alone cost
    // roughly 100pt and pushed the "I'm not sure" chip under the footer —
    // which defeats the point of putting these three questions together.
    { title: 'When and how long', hint: 'Add the clip if you filmed it. Only the date is required.' },
    { title: 'What you saw', hint: 'Tap anything you remember. Skip what you did not see.' },
    { title: 'Around the seizure', hint: 'Before, after, and anything else. Then save.' },
  ] as const;

  const LAST = STEP_DEFS.length - 1;
  // Only the date gates progress, and only on the step that asks for it.
  // Blocking the final Save for something asked two screens ago is a dead end
  // the owner cannot see the cause of.
  const blocked = step === 0 && startedAt === null;

  return (
    <StepShell
      steps={STEP_DEFS}
      current={step}
      subtitle="Add a past seizure"
      onBack={() => setStep(step - 1)}
      onNext={() => setStep(step + 1)}
      onClose={() => goBackOrHome(router)}
      finishLabel={saving ? 'Saving…' : 'Save this record'}
      onFinish={() => void onSave()}
      busy={saving}
      disabled={step === LAST ? !canSave : blocked}
    >
      {step === 0 && (
        <>
        {/* Compact by design: this whole step must fit above the fold, so the
            video block is a single row rather than a titled card of its own. */}
        <Card style={styles.videoCard}>
          {videos.length === 0 ? (
            <Muted style={styles.videoHint}>
              If you filmed it, add the clip here.
            </Muted>
          ) : (
            <View style={styles.videoStrip}>
              {videos.map((v, i) => (
                <View key={v.fileUri} style={styles.videoThumbWrap}>
                  {/* thumbUri is RELATIVE to the document directory (see
                      fileStore.ts). Handing that straight to <Image> makes iOS
                      resolve it against the app BUNDLE, so the tile silently
                      renders blank — resolve it first. */}
                  {v.thumbUri ? (
                    <Image
                      source={{ uri: thumbnailUri(v.thumbUri) }}
                      style={styles.videoThumb}
                    />
                  ) : (
                    <View style={[styles.videoThumb, styles.videoThumbBlank]} />
                  )}
                  <Pressable
                    onPress={() => setVideos((prev) => prev.filter((_, n) => n !== i))}
                    accessibilityRole="button"
                    accessibilityLabel={`Remove video ${i + 1}`}
                    hitSlop={8}
                    style={styles.videoRemove}
                  >
                    <Icon name="clear" size="sm" color={colors.onMedia} />
                  </Pressable>
                </View>
              ))}
            </View>
          )}
          <Button
            label={videos.length === 0 ? 'Add a video' : 'Add another'}
            variant="ghost"
            loading={picking}
            onPress={onAddVideo}
            accessibilityHint="Choose a seizure video from your photo library or Files"
            style={styles.videoBtn}
          />
        </Card>

        <DateTimeField
          value={startedAt}
          onChange={(epochMs, known) => {
            setStartedAt(epochMs);
            setTimeKnown(known);
          }}
        />

        <QuestionLabel hint={'"I\u2019m not sure" is a real answer.'}>
          How long did it last?
        </QuestionLabel>
          <View style={styles.durationInputs}>
            <NumberBox
              value={minutes}
              onChange={setMinutes}
              suffix="min"
              accessibilityLabel="Minutes"
            />
            <NumberBox
              value={seconds}
              onChange={setSeconds}
              suffix="sec"
              accessibilityLabel="Seconds"
            />
          </View>
          <Pressable
            onPress={() => setDurationKnown(!durationKnown)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !durationKnown }}
            accessibilityLabel="I am not sure how long it lasted"
            style={({ pressed }) => [
              styles.unknown,
              !durationKnown && styles.unknownOn,
              pressed && { opacity: 0.9 },
            ]}
          >
            <Text
              style={[styles.unknownLabel, !durationKnown && styles.unknownLabelOn]}
            >
              I&rsquo;m not sure
            </Text>
          </Pressable>
          {durationError ? (
            <Body style={styles.error}>{durationError}</Body>
          ) : durationKnown && durationSec !== null ? (
            <Muted style={styles.durationEcho}>
              About {formatDuration(durationSec)} — recorded as your estimate.
            </Muted>
          ) : null}
        </>
      )}

      {/* Everything the owner actually watched, in one place. These were four
          separate screens; none of them asks a question that needs the screen
          to itself. */}
      {step === 1 && (
        <>
          <QuestionLabel>Movement</QuestionLabel>
          <MovementField value={obs} on={handlers} />
          <QuestionLabel>Were they aware of you?</QuestionLabel>
          <AwarenessField value={obs} on={handlers} />
          <QuestionLabel>Body position</QuestionLabel>
          <PositionField value={obs} on={handlers} />
          <QuestionLabel hint="Drooling, wetting, and the like.">
            Autonomic signs
          </QuestionLabel>
          <AutonomicField value={obs} on={handlers} />
        </>
      )}

      {step === LAST && (
        <>
          <QuestionLabel hint="Warning signs in the minutes or hours before it started.">
            Anything unusual beforehand?
          </QuestionLabel>
          <PreIctalField value={obs} on={handlers} />
          <QuestionLabel>How was {dog.name} afterwards?</QuestionLabel>
          <PostBehaviorField value={obs} on={handlers} />
          <QuestionLabel hint="Your own impression, not a clinical grade.">
            How did it look to you?
          </QuestionLabel>
          <SeverityField value={obs} on={handlers} />

          <QuestionLabel>Notes</QuestionLabel>
          <TextArea
            value={notes}
            onChangeText={setNotes}
            placeholder="Anything you remember that does not fit above."
            accessibilityLabel="Notes"
          />
          {error ? <Body style={styles.error}>{error}</Body> : null}
          <Muted style={styles.footnote}>
            Saved as &ldquo;logged later&rdquo;. History and the vet report show
            that label, and the pattern analysis keeps remembered durations out
            of its timing figures.
          </Muted>
        </>
      )}
    </StepShell>
  );
}

/**
 * A number field that stays visible when it is not in use.
 *
 * Dimmed rather than hidden when "I'm not sure" is chosen: the owner has to be
 * able to see that the box is still there and still theirs to fill in, or
 * toggling the chip looks like the app removed the option.
 */
function NumberBox({
  value,
  onChange,
  suffix,
  accessibilityLabel,
  disabled = false,
}: {
  value: string;
  onChange: (next: string) => void;
  suffix: string;
  accessibilityLabel: string;
  disabled?: boolean;
}) {
  return (
    <View style={[styles.numberBox, disabled && styles.numberBoxOff]}>
      <TextInput
        style={styles.numberInput}
        value={value}
        onChangeText={(text) => onChange(text.replace(/[^0-9]/g, ''))}
        keyboardType="number-pad"
        maxLength={3}
        editable={!disabled}
        placeholder="0"
        placeholderTextColor={colors.inkSoft}
        accessibilityLabel={accessibilityLabel}
      />
      <Text style={styles.numberSuffix}>{suffix}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  // Tighter than a normal Card: step 1 has to fit three questions above the
  // fold, and the video row is the one that can afford to give up the space.
  videoCard: { paddingVertical: spacing.sm },
  videoHint: { marginBottom: spacing.sm },
  videoBtn: { marginTop: spacing.sm },
  videoStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  videoThumbWrap: { position: 'relative' },
  videoThumb: {
    width: 84,
    height: 84,
    borderRadius: radius.field,
    backgroundColor: colors.line,
  },
  videoThumbBlank: { borderWidth: 1, borderColor: colors.line },
  videoRemove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 24,
    height: 24,
    borderRadius: 12, // A circle: half of 24.
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.ink,
  },

  durationInputs: { flexDirection: 'row', gap: spacing.sm },
  numberBox: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  numberBoxOff: { opacity: 0.45 },
  numberInput: { flex: 1, fontSize: fontSize.md, color: colors.ink, fontFamily: fontFamily.regular },
  numberSuffix: { fontSize: fontSize.sm, color: colors.inkSoft, fontWeight: '700', fontFamily: fontFamily.bold },

  unknown: {
    alignSelf: 'flex-start',
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.line,
    marginTop: spacing.xs,
  },
  unknownOn: { backgroundColor: colors.tealTint, borderColor: colors.teal },
  unknownLabel: { fontSize: fontSize.sm, fontWeight: '700', color: colors.inkSoft, fontFamily: fontFamily.bold },
  unknownLabelOn: { color: colors.tealDeep },

  durationEcho: { marginTop: spacing.xs },
  error: { color: colors.redDeep, marginTop: spacing.xs },
  footnote: { lineHeight: 18, marginTop: spacing.sm },
});
