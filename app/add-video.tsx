/**
 * Log a seizure from a video the owner already has.
 *
 * ── WHY THIS IS NOT INSIDE app/seizure/ ───────────────────────────────
 *
 * That folder is the emergency stack: back gestures are disabled across the
 * whole thing so an accidental swipe cannot interrupt a live recording. An
 * import is the opposite situation — the seizure is over, the owner is calm,
 * and trapping them in a form they cannot swipe out of would be hostile. So it
 * lives at the top level, with normal navigation.
 *
 * ── THE ONE THING THE APP CANNOT KNOW ─────────────────────────────────
 *
 * expo-image-picker hands back a temp copy of the chosen asset with no
 * reliable original capture date, so there is no honest way to derive when an
 * imported seizure happened. The date field is therefore REQUIRED and the
 * record is written with:
 *
 *   retrospective     true              logged after the fact
 *   timingConfidence  'approximate'     the owner recalled it
 *   captureConfidence 'owner_stated'    on every video row
 *
 * Three separate signals, because each one is read by a different consumer:
 * the analytics engine weights retrospective records differently, the history
 * list badges timing confidence, and the gallery badges the video's own date.
 *
 * ── DURATION IS ALLOWED TO BE UNKNOWN ─────────────────────────────────
 *
 * "I don't know how long" is a first-class answer, not a validation failure.
 * An owner who filmed thirty seconds of a seizure that had already started
 * cannot honestly state its length, and forcing a number out of them puts a
 * fabricated duration into the median their vet reads.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Alert,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, Disclaimer, Muted, Pill } from '@/components/ui';
import {
  ActionBar,
  QuestionLabel,
  ScreenHeader,
  SectionRule,
  TextAction,
} from '@/components/form';
import { DateTimeField } from '@/components/DateTimeField';
import { VideoTile } from '@/components/VideoTile';
import {
  AftermathFields,
  EMPTY_OBSERVATIONS,
  IctalFields,
  type MultiField,
  type ObservationValue,
  type SingleField,
  type TextField,
} from '@/components/ObservationFields';
import { colors, fontSize, radius, spacing, MIN_TOUCH_TARGET } from '@/theme/tokens';
import { useActiveDog } from '@/store/appStore';
import * as seizureRepo from '@/db/seizureRepo';
import * as videoRepo from '@/db/videoRepo';
import {
  deleteVideoAssets,
  importVideos,
  type CapturedVideo,
} from '@/services/videoService';
import { formatDuration } from '@/utils/time';

/** Six hours, matching MAX_PLAUSIBLE_SEIZURE_SECONDS in utils/clock. */
const MAX_SECONDS = 6 * 60 * 60;

export default function AddVideoScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dog = useActiveDog();

  const [videos, setVideos] = useState<CapturedVideo[]>([]);
  const [picking, setPicking] = useState(false);
  const [saving, setSaving] = useState(false);

  const [startedAt, setStartedAt] = useState<number | null>(null);
  const [durationKnown, setDurationKnown] = useState(true);
  const [minutes, setMinutes] = useState('');
  const [seconds, setSeconds] = useState('');

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

  /* -------------------------------------------------------------- */

  const durationSec = useMemo(() => {
    if (!durationKnown) return null;
    const m = Number(minutes || '0');
    const s = Number(seconds || '0');
    if (!Number.isFinite(m) || !Number.isFinite(s)) return null;
    const total = Math.round(m * 60 + s);
    if (total <= 0) return null;
    if (total > MAX_SECONDS) return null;
    return total;
  }, [durationKnown, minutes, seconds]);

  const durationError = (() => {
    if (!durationKnown) return null;
    if (!minutes && !seconds) return null;
    const total = Math.round(Number(minutes || '0') * 60 + Number(seconds || '0'));
    if (total <= 0) return 'A zero-second seizure is a mis-tap. Leave it blank if you are not sure.';
    if (total > MAX_SECONDS) return 'That is longer than six hours. Check the minutes.';
    return null;
  })();

  const canSave =
    !saving &&
    videos.length > 0 &&
    startedAt !== null &&
    durationError === null &&
    (!durationKnown || durationSec !== null);

  /* -------------------------------------------------------------- */

  const onPick = useCallback(async () => {
    setPicking(true);
    try {
      const picked = await importVideos({ multiple: true });
      if (picked.length > 0) setVideos((prev) => [...prev, ...picked]);
    } catch (e) {
      Alert.alert(
        'Could not add the video',
        e instanceof Error ? e.message : 'Please try again.',
      );
    } finally {
      setPicking(false);
    }
  }, []);

  const onRemove = useCallback((fileUri: string) => {
    setVideos((prev) => {
      const target = prev.find((v) => v.fileUri === fileUri);
      // The file was copied into permanent storage the moment it was picked,
      // so removing it from the list has to remove it from disk too — nothing
      // else will ever point at it.
      if (target) deleteVideoAssets(target);
      return prev.filter((v) => v.fileUri !== fileUri);
    });
  }, []);

  const onDiscard = useCallback(() => {
    if (videos.length === 0) {
      router.back();
      return;
    }
    Alert.alert(
      'Discard this record?',
      `The ${videos.length} video${videos.length === 1 ? '' : 's'} you added will be removed from the app. The original${videos.length === 1 ? '' : 's'} in your photo library ${videos.length === 1 ? 'is' : 'are'} not touched.`,
      [
        { text: 'Keep editing', style: 'cancel' },
        {
          text: 'Discard',
          style: 'destructive',
          onPress: () => {
            for (const video of videos) deleteVideoAssets(video);
            router.back();
          },
        },
      ],
    );
  }, [videos, router]);

  const onSave = useCallback(async () => {
    if (!dog || startedAt === null) return;
    setSaving(true);
    try {
      const known = durationKnown && durationSec !== null;

      const seizureId = await seizureRepo.createSeizure({
        dogId: dog.id,
        start: startedAt,
        end: known ? startedAt + durationSec * 1000 : null,
        durationSec: known ? durationSec : 0,
        // 'approximate' when the owner gave a length, 'unknown' when they did
        // not. Both are honest; neither is 'exact', which is reserved for a
        // duration the app itself measured.
        timingConfidence: known ? 'approximate' : 'unknown',
        // Deliberately NOT 'high'. The owner recalled this number; only the
        // in-app stopwatch earns high confidence.
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
        context: {
          food: '', sleep: '', exercise: '', medication: '',
          stress: '', environment: '', illness: '', exposure: '',
        },
        notes: obs.notes,
      });

      // The seizure row is the clinical record; a failed video attach must not
      // take it down with it. Same rule as saveActiveSeizure.
      let failed = 0;
      for (const video of videos) {
        try {
          await videoRepo.attachVideo({
            seizureId,
            source: 'uploaded',
            fileUri: video.fileUri,
            thumbUri: video.thumbUri,
            timestamp: startedAt,
            importedAt: Date.now(),
            captureConfidence: 'owner_stated',
            durationSec: video.durationSec,
            note: '',
          });
        } catch (e) {
          failed += 1;
          console.error('[add-video] could not attach video', e);
        }
      }

      if (failed > 0) {
        Alert.alert(
          'Record saved, but not every video',
          `${failed} of ${videos.length} could not be attached. The seizure record itself is safe.`,
        );
      }

      router.replace(`/seizure-detail/${seizureId}`);
    } catch (e) {
      console.error('[add-video] save failed', e);
      Alert.alert(
        'Could not save this record',
        'Nothing was lost — your answers are still on screen. Please try again.',
      );
      setSaving(false);
    }
  }, [dog, startedAt, durationKnown, durationSec, obs, videos, router]);

  /* -------------------------------------------------------------- */

  if (!dog) return null;

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.md },
        ]}
        keyboardShouldPersistTaps="handled"
      >
        <ScreenHeader
          eyebrow="Added afterwards"
          title="Add a video"
          subtitle={`For a seizure you filmed on your phone. Because the app did not time it, this record is marked as your own recollection rather than a measurement.`}
          action={<TextAction label="Cancel" onPress={onDiscard} />}
        />

        {/* --- 1. The videos ---------------------------------------- */}
        <SectionRule label="Video" count={videos.length} />

        {videos.length > 0 ? (
          <View style={styles.strip}>
            {videos.map((video) => (
              <View key={video.fileUri} style={styles.stripItem}>
                <VideoTile
                  thumbUri={video.thumbUri}
                  durationSec={video.durationSec}
                  accessibilityLabel="Video to be added to this record"
                  aspect={0.82}
                />
                <Pressable
                  onPress={() => onRemove(video.fileUri)}
                  accessibilityRole="button"
                  accessibilityLabel="Remove this video"
                  style={styles.remove}
                >
                  <Text style={styles.removeIcon}>✕</Text>
                </Pressable>
              </View>
            ))}
          </View>
        ) : (
          <Card>
            <Body>No video chosen yet.</Body>
            <Muted style={{ marginTop: 4 }}>
              You can add several clips of the same seizure. They are copied
              into the app — your originals stay in your photo library.
            </Muted>
          </Card>
        )}

        <Button
          label={picking ? 'Opening your library…' : videos.length > 0 ? 'Add another clip' : 'Choose from my phone'}
          variant={videos.length > 0 ? 'ghost' : 'primary'}
          loading={picking}
          onPress={onPick}
          style={{ marginTop: spacing.md }}
          accessibilityHint="Opens your photo library to pick a video"
        />

        {/* --- 2. When ---------------------------------------------- */}
        <DateTimeField value={startedAt} onChange={setStartedAt} />

        {/* --- 3. How long ------------------------------------------ */}
        <SectionRule label="How long did it last?" />
        <View style={styles.durationRow}>
          <View style={styles.durationInputs}>
            <NumberBox
              value={minutes}
              onChangeText={(t) => {
                setDurationKnown(true);
                setMinutes(t.replace(/[^0-9]/g, ''));
              }}
              suffix="min"
              accessibilityLabel="Minutes"
              editable={durationKnown}
            />
            <NumberBox
              value={seconds}
              onChangeText={(t) => {
                setDurationKnown(true);
                setSeconds(t.replace(/[^0-9]/g, ''));
              }}
              suffix="sec"
              accessibilityLabel="Seconds"
              editable={durationKnown}
            />
          </View>
          <Pressable
            onPress={() => {
              setDurationKnown((prev) => !prev);
              setMinutes('');
              setSeconds('');
            }}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: !durationKnown }}
            accessibilityLabel="I do not know how long it lasted"
            style={({ pressed }) => [
              styles.unknown,
              !durationKnown && styles.unknownOn,
              pressed && { opacity: 0.7 },
            ]}
          >
            <Text
              style={[
                styles.unknownLabel,
                !durationKnown && styles.unknownLabelOn,
              ]}
            >
              {!durationKnown ? '✓ ' : ''}I&apos;m not sure
            </Text>
          </Pressable>
        </View>

        {durationError ? (
          <Text style={styles.error} accessibilityLiveRegion="polite">
            {durationError}
          </Text>
        ) : durationKnown && durationSec !== null ? (
          <View style={styles.durationEcho}>
            <Pill label={formatDuration(durationSec)} tone="teal" />
            <Muted>recorded as your estimate</Muted>
          </View>
        ) : (
          <Muted style={{ marginTop: spacing.sm }}>
            Leave this blank if you only caught part of it. The record will read
            &ldquo;Not timed&rdquo; rather than showing a guess.
          </Muted>
        )}

        {/* --- 4. What it looked like ------------------------------- */}
        <QuestionLabel hint="Everything from here down is optional and can be changed later.">
          What did the seizure look like?
        </QuestionLabel>
        <IctalFields value={obs} on={handlers} />

        {/* --- 5. Around it ----------------------------------------- */}
        <SectionRule label="Around the seizure" />
        <AftermathFields value={obs} on={handlers} dogName={dog.name} />

        <Disclaimer>
          This record is marked as logged after the event. Your vet sees that
          alongside it, so an estimated length is never mistaken for a timed one.
        </Disclaimer>
      </ScrollView>

      <ActionBar bottomInset={insets.bottom}>
        <Button
          label={saving ? 'Saving…' : 'Save this record'}
          large
          loading={saving}
          disabled={!canSave}
          onPress={onSave}
          accessibilityHint={
            canSave
              ? 'Saves the video and everything you entered'
              : 'Add a video and a date first'
          }
        />
        {!canSave && !saving ? (
          <Muted style={styles.gate}>
            {videos.length === 0
              ? 'Choose a video to continue.'
              : startedAt === null
                ? 'Enter the date and time it happened.'
                : 'Check the length you entered.'}
          </Muted>
        ) : null}
      </ActionBar>
    </View>
  );
}

/* ------------------------------------------------------------------ */

function NumberBox({
  value,
  onChangeText,
  suffix,
  accessibilityLabel,
  editable,
}: {
  value: string;
  onChangeText: (text: string) => void;
  suffix: string;
  accessibilityLabel: string;
  editable: boolean;
}) {
  return (
    <View style={[styles.numberBox, !editable && styles.numberBoxOff]}>
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder="0"
        placeholderTextColor={colors.inkSoft}
        keyboardType="number-pad"
        maxLength={3}
        editable={editable}
        accessibilityLabel={accessibilityLabel}
        style={styles.numberInput}
      />
      <Text style={styles.numberSuffix}>{suffix}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },

  strip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  stripItem: { width: '31%', position: 'relative' },
  remove: {
    position: 'absolute',
    top: -6,
    right: -6,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
    alignItems: 'center',
    justifyContent: 'center',
  },
  removeIcon: { fontSize: 13, fontWeight: '700', color: colors.ink },

  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    flexWrap: 'wrap',
  },
  durationInputs: { flexDirection: 'row', gap: spacing.sm },
  numberBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
  },
  numberBoxOff: { opacity: 0.45 },
  numberInput: {
    minWidth: 44,
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
    textAlign: 'center',
    fontVariant: ['tabular-nums'],
  },
  numberSuffix: { fontSize: fontSize.sm, color: colors.inkSoft, fontWeight: '600' },

  unknown: {
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.lg,
    justifyContent: 'center',
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.card,
  },
  unknownOn: { backgroundColor: colors.tealTint, borderColor: colors.teal },
  unknownLabel: { fontSize: fontSize.base, fontWeight: '600', color: colors.ink },
  unknownLabelOn: { color: colors.tealDeep, fontWeight: '800' },

  durationEcho: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  error: {
    marginTop: spacing.sm,
    fontSize: fontSize.sm,
    fontWeight: '600',
    color: colors.redDeep,
    lineHeight: fontSize.sm * 1.45,
  },
  gate: { textAlign: 'center' },
});
