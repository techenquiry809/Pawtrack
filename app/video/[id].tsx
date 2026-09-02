/**
 * One video, and everything the app knows about the day it happened.
 *
 * ── WHY THE RECORD IS ON THIS SCREEN AND NOT A TAP AWAY ───────────────
 *
 * An owner opening a video from the gallery is not asking "may I watch this
 * clip". They are asking "what happened that day?" — the clip is the fastest
 * way into the memory, and the observations are the answer. Putting the record
 * behind a second tap would make the gallery a media browser, which is not
 * what a seizure diary needs.
 *
 * ── PLAYBACK IS expo-video, NOT expo-av ───────────────────────────────
 *
 * expo-av's Video component is deprecated. `useVideoPlayer` gives us a player
 * object we can hold, which matters here: the player is paused on unmount so
 * navigating away never leaves seizure audio playing over the next screen.
 */

import { useCallback, useEffect, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

import {
  Body, Button, Card, Disclaimer, Heading, Muted, Pill, type PillTone,
} from '@/components/ui';
import { ScreenHeader, SectionRule, TextAction } from '@/components/form';
import { BackButton } from '@/components/BackButton';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';
import * as videoRepo from '@/db/videoRepo';
import * as seizureRepo from '@/db/seizureRepo';
import { deleteVideoAssets, videoFileUri } from '@/services/videoService';
import { deviceNames } from '@/services/sync/devices';
import { saveVideoToPhone, shareVideo } from '@/services/mediaExport';
import { formatDuration, formatFullDate, formatInterval, hasKnownTime, timeOfDay } from '@/utils/time';
import { CAPTURE_CONFIDENCE_LABEL, type SeizureWithVideos, type Video } from '@/types/domain';

export default function VideoDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [video, setVideo] = useState<Video | null>(null);
  const [seizure, setSeizure] = useState<SeizureWithVideos | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<null | 'saving' | 'sharing'>(null);
  /**
   * The phone that recorded this, when it was not this one. Read from the
   * locally cached registry so the answer is still right with no signal —
   * which is exactly when an owner is trying to work out where a clip is.
   */
  const [originDeviceName, setOriginDeviceName] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let cancelled = false;
    (async () => {
      try {
        const found = await videoRepo.getVideo(id);
        if (cancelled) return;
        setVideo(found);
        if (found) {
          const record = await seizureRepo.getSeizure(found.seizureId);
          if (!cancelled) setSeizure(record);

          if (!found.isLocal && found.originDeviceId) {
            const names = await deviceNames();
            if (!cancelled) {
              setOriginDeviceName(names[found.originDeviceId] ?? null);
            }
          }
        }
      } catch (e) {
        console.error('[video] load failed', e);
      } finally {
        if (!cancelled) setLoaded(true);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [id]);

  // NULL, not '', until the row loads.
  //
  // expo-video's parseSource turns a string into `{ uri: source }` unchanged,
  // so '' would hand the native player an empty URI to go and load — an
  // AVPlayerItem pointed at nothing, which fails on the native side rather than
  // sitting idle. `null` is the type's documented "no source yet" value and is
  // passed straight through. useVideoPlayer keys its player on the source, so
  // the real URI still swaps a fresh player in when the row arrives.
  //
  // It is never autoplayed: a seizure video that starts the moment the screen
  // opens is distressing, and may be opened in a waiting room.
  const source = video ? videoFileUri(video.fileUri) : null;
  const player = useVideoPlayer(source, (instance) => {
    instance.loop = false;
    instance.muted = false;
  });

  useEffect(() => {
    // Stop audio the instant the owner leaves, whatever route they take.
    return () => {
      try {
        player.pause();
      } catch {
        /* player already released */
      }
    };
  }, [player]);

  const onSave = useCallback(async () => {
    if (!video) return;
    setBusy('saving');
    const outcome = await saveVideoToPhone(video.fileUri);
    setBusy(null);
    if (outcome.status === 'saved') {
      Alert.alert('Saved to your phone', `You'll find it in Photos, under "${outcome.album}".`);
    } else if (outcome.status === 'denied' || outcome.status === 'missing') {
      Alert.alert('Could not save the video', outcome.message);
    }
  }, [video]);

  const onShare = useCallback(async () => {
    if (!video) return;
    setBusy('sharing');
    const outcome = await shareVideo(video.fileUri);
    setBusy(null);
    if (outcome.status === 'denied' || outcome.status === 'missing') {
      Alert.alert('Could not share the video', outcome.message);
    }
  }, [video]);

  const onDelete = useCallback(() => {
    if (!video) return;
    Alert.alert(
      'Delete this video?',
      'The seizure record and all of its observations are kept. Only the video file is removed, and this cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete video',
          style: 'destructive',
          onPress: async () => {
            try {
              const paths = await videoRepo.detachVideo(video.id);
              // Row first, bytes second. An orphaned file is a wasted megabyte;
              // an orphaned row is a tile that crashes the gallery on tap.
              if (paths) deleteVideoAssets(paths);
              router.back();
            } catch (e) {
              console.error('[video] delete failed', e);
              Alert.alert('Could not delete the video', 'Please try again.');
            }
          },
        },
      ],
    );
  }, [video, router]);

  /* -------------------------------------------------------------- */

  if (!loaded) {
    return (
      <View style={[styles.screen, styles.centre]}>
        <Muted>Loading…</Muted>
      </View>
    );
  }

  if (!video) {
    return (
      <ScrollView
        style={styles.screen}
        contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
      >
        <ScreenHeader
          title="Video not found"
          subtitle="This recording is no longer in the app. If you deleted it, the seizure record it belonged to is still in your history."
          action={<BackButton variant="plain" />}
        />
      </ScrollView>
    );
  }

  const stated = video.captureConfidence !== 'device';

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <ScreenHeader
        eyebrow={video.source === 'uploaded' ? 'Added from your phone' : 'Filmed in the app'}
        title={formatFullDate(video.timestamp)}
        /*
          The clock time only when there is one, then the provenance label.

          Gated on the SEIZURE's timingConfidence, not the clip's
          captureConfidence: the clip's timestamp is that seizure's `start`
          copied at attach time, and captureConfidence is 'owner_stated' on
          every imported clip — it describes where the DATE came from and
          cannot say whether an hour was ever given. Reading it here printed
          "00:00" on every imported video.
        */
        subtitle={[
          timeOfDay(
            video.timestamp,
            seizure !== null && hasKnownTime(seizure.timingConfidence),
          ),
          CAPTURE_CONFIDENCE_LABEL[video.captureConfidence],
        ]
          .filter(Boolean)
          .join(' · ')}
        action={<BackButton variant="plain" />}
      />

      {/* --- Player ------------------------------------------------ */}
      {/*
        A video whose bytes are on another phone.

        Seizure video files never leave the device that recorded them, so on a
        second device there is a complete clinical record here and nothing to
        play. That gets a designed state rather than a player showing a black
        rectangle: the record is intact, the frames are simply elsewhere, and
        the owner needs to be told which phone to go and get rather than left
        to conclude the app lost their video.
      */}
      {video.isLocal ? (
        <View style={styles.playerWrap}>
          <VideoView
            player={player}
            style={styles.player}
            nativeControls
            // expo-video 57 replaced the boolean `allowsFullscreen` with this
            // options object. The boolean is not merely deprecated — it is not in
            // VideoViewProps at all, so it was silently doing nothing.
            fullscreenOptions={{ enable: true }}
            allowsPictureInPicture={false}
            contentFit="contain"
          />
        </View>
      ) : (
        <Card style={styles.remoteCard}>
          <Pill label="Not on this device" tone="teal" />
          <Heading>
            Recorded on {originDeviceName ?? 'another device'}
          </Heading>
          <Muted style={styles.statedText}>
            Seizure videos stay on the phone that filmed them — they are never
            uploaded. Everything else about this seizure is here in full; only
            the recording itself is on {originDeviceName ?? 'the other phone'}.
          </Muted>
        </Card>
      )}

      {stated ? (
        <View style={styles.statedNote}>
          <Pill
            label={video.captureConfidence === 'unknown' ? 'Date unknown' : 'Date entered by you'}
            tone="amber"
          />
          <Muted style={styles.statedText}>
            {video.captureConfidence === 'unknown'
              ? 'This clip was added before the app asked when seizures happened, so its date is the day it was imported.'
              : 'The app did not time this seizure, so the date and any length are your own recollection.'}
          </Muted>
        </View>
      ) : null}

      {/* --- Actions ----------------------------------------------- */}
      {/* Saving and sending both need the file. Offering them on a device
          that does not have it would produce a failure the owner cannot act
          on. Deleting the RECORD is still available below, because that is a
          clinical edit and syncs from anywhere. */}
      <View style={[styles.actions, !video.isLocal && styles.hidden]}>
        <Button
          label={busy === 'saving' ? 'Saving…' : 'Save to my phone'}
          loading={busy === 'saving'}
          onPress={onSave}
          style={styles.flex}
          accessibilityHint="Adds this video to your Photos app in a PawTrack album"
        />
        <Button
          label={busy === 'sharing' ? 'Opening…' : 'Send'}
          variant="ghost"
          loading={busy === 'sharing'}
          onPress={onShare}
          style={styles.flex}
          accessibilityHint="Opens the share sheet to send this video to your vet"
        />
      </View>

      {/* --- What this clip shows ----------------------------------- */}
      <PhaseNotes video={video} onSaved={(patch) => setVideo({ ...video, ...patch })} />

      {/* --- The record it belongs to ------------------------------ */}
      {seizure ? (
        <SeizureSummary seizure={seizure} onOpen={() => router.push(`/seizure-detail/${seizure.id}`)} />
      ) : (
        <Card style={{ marginTop: spacing.lg }}>
          <Heading>The record for this video is missing</Heading>
          <Muted style={{ marginTop: 6 }}>
            The video is still playable, but the seizure it belonged to is no
            longer in your history.
          </Muted>
        </Card>
      )}

      <TextAction label="Delete this video" tone="red" onPress={onDelete} />

      <Disclaimer>
        The video file stays on this phone and is never uploaded. The record of
        it — including anything you write above — is backed up to your account
        when you are signed in.
      </Disclaimer>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */

function SeizureSummary({
  seizure,
  onOpen,
}: {
  seizure: SeizureWithVideos;
  onOpen: () => void;
}) {
  // "Not timed" means there is NO duration — not merely that the one we have is
  // low confidence. Testing durationConfidence here used to discard a real
  // number: an imported record is written 'unreliable' BY DESIGN (only the
  // stopwatch earns 'high'), so an owner who typed "2 min 10 sec" was told the
  // app had captured nothing. How confident the figure is belongs on the badge
  // below, which already says so.
  const untimed = seizure.durationSec === null || seizure.durationSec === 0;

  const groups: { label: string; values: string[] }[] = [
    { label: 'Before', values: seizure.preIctalObs },
    { label: 'Movement', values: seizure.ictalObs },
    { label: 'Autonomic', values: seizure.autonomic },
    { label: 'Afterwards', values: seizure.postBehavior },
  ].filter((group) => group.values.length > 0);

  const singles: { label: string; value: string | null }[] = [
    { label: 'Awareness', value: seizure.awareness },
    { label: 'Position', value: seizure.position },
    { label: 'Looked', value: seizure.severityOwner },
  ].filter((item) => !!item.value);

  const nothingRecorded = groups.length === 0 && singles.length === 0 && !seizure.notes;

  return (
    <>
      <SectionRule label="What was recorded" />

      <Card>
        <View style={styles.summaryTop}>
          <Heading>{untimed ? 'Not timed' : formatDuration(seizure.durationSec)}</Heading>
          <View style={styles.badgeRow}>
            {seizure.retrospective ? <Pill label="Logged later" tone="neutral" /> : null}
            {seizure.durationConfidence === 'recovered' ? (
              <Pill label="Estimated" tone="amber" />
            ) : null}
          </View>
        </View>

        {seizure.timeSincePrevSec !== null ? (
          <Muted style={{ marginTop: 6 }}>
            {formatInterval(seizure.timeSincePrevSec)} since the previous
            recorded seizure.
          </Muted>
        ) : null}

        {seizure.recoverySec !== null ? (
          <Muted style={{ marginTop: 4 }}>
            Recovery took {formatDuration(seizure.recoverySec)}.
          </Muted>
        ) : null}
      </Card>

      {nothingRecorded ? (
        <Card>
          <Heading>No observations yet</Heading>
          <Muted style={{ marginTop: 6 }}>
            You can add what you remember at any time — nothing about this
            record is fixed.
          </Muted>
          <Button
            label="Add observations"
            variant="ghost"
            onPress={onOpen}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      ) : (
        <Card>
          {groups.map((group) => (
            <View key={group.label} style={styles.group}>
              <Text style={styles.groupLabel}>{group.label}</Text>
              <Text style={styles.groupValues}>{group.values.join(' · ')}</Text>
            </View>
          ))}

          {singles.length > 0 ? (
            <View style={styles.singleRow}>
              {singles.map((item) => (
                <SinglePill key={item.label} label={item.label} value={item.value!} />
              ))}
            </View>
          ) : null}

          {seizure.notes ? (
            <View style={styles.group}>
              <Text style={styles.groupLabel}>Notes</Text>
              <Body>{seizure.notes}</Body>
            </View>
          ) : null}

          <Button
            label="Open the full record"
            variant="ghost"
            onPress={onOpen}
            style={{ marginTop: spacing.md }}
          />
        </Card>
      )}
    </>
  );
}

function SinglePill({ label, value }: { label: string; value: string }) {
  const tone: PillTone = 'neutral';
  return (
    <View style={styles.singlePill}>
      <Text style={styles.singleLabel}>{label}</Text>
      <Pill label={value} tone={tone} />
    </View>
  );
}

/**
 * Before / during / after, for this clip.
 *
 * ── WHY THIS IS SEPARATE FROM THE SEIZURE'S OWN OBSERVATIONS ──────────
 *
 * The seizure record already carries structured observations picked from fixed
 * vocabularies. These are free text and describe the FOOTAGE, which is a
 * different thing — and the case they exist for is an imported clip, where
 * there was never a live capture and the seizure row is thin. What the owner
 * can still say is what the video shows.
 *
 * ── SAVED PER FIELD, ON BLUR ──────────────────────────────────────────
 *
 * No Save button. Each field writes when it loses focus and only if it
 * actually changed, so a note typed at 3am is not lost to a backgrounded app,
 * and tabbing through three fields does not queue three redundant syncs.
 */
function PhaseNotes({
  video,
  onSaved,
}: {
  video: Video;
  onSaved: (patch: Partial<Video>) => void;
}) {
  const FIELDS = [
    {
      key: 'preNote' as const,
      label: 'BEFORE THE SEIZURE',
      hint: 'Anything you noticed in the lead-up — pacing, hiding, clinginess.',
      placeholder: 'She was circling the kitchen for a minute or two…',
    },
    {
      key: 'ictalNote' as const,
      label: 'DURING THE SEIZURE',
      hint: 'What the clip itself shows.',
      placeholder: 'Paddling on her left side, jaw chomping, eyes open…',
    },
    {
      key: 'postNote' as const,
      label: 'AFTER THE SEIZURE',
      hint: 'How the recovery went, including anything after the clip ends.',
      placeholder: 'Disoriented for about ten minutes, then drank a lot…',
    },
  ];

  return (
    <View style={{ marginTop: spacing.lg }}>
      <SectionRule label="What this clip shows" />
      <Muted style={{ marginBottom: spacing.md }}>
        Optional, and only about this recording. The seizure record keeps its
        own observations.
      </Muted>

      <View style={{ gap: spacing.md }}>
        {FIELDS.map((field) => (
          <PhaseNoteField
            key={field.key}
            label={field.label}
            hint={field.hint}
            placeholder={field.placeholder}
            value={video[field.key]}
            onCommit={async (next) => {
              if (next === video[field.key]) return;
              await videoRepo.updateVideo(video.id, { [field.key]: next });
              onSaved({ [field.key]: next });
            }}
          />
        ))}
      </View>
    </View>
  );
}

function PhaseNoteField({
  label,
  hint,
  placeholder,
  value,
  onCommit,
}: {
  label: string;
  hint: string;
  placeholder: string;
  value: string;
  onCommit: (next: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState(false);

  // Re-sync when the row is reloaded under us (a pull, or another field's
  // save), but never while the owner is mid-sentence in THIS field.
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    if (!focused) setDraft(value);
  }, [value, focused]);

  return (
    <View>
      <Text style={styles.phaseLabel}>{label}</Text>
      <Muted style={styles.phaseHint}>{hint}</Muted>
      <TextInput
        value={draft}
        onChangeText={(next) => {
          setDraft(next);
          setSaved(false);
        }}
        onFocus={() => setFocused(true)}
        onBlur={() => {
          setFocused(false);
          void onCommit(draft.trim()).then(() => {
            if (draft.trim() !== value) setSaved(true);
          });
        }}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSoft}
        multiline
        style={styles.phaseInput}
        accessibilityLabel={label}
        maxLength={1000}
      />
      {saved ? <Text style={styles.phaseSaved}>Saved</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  phaseLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.inkSoft,
    letterSpacing: 0.6,
    fontFamily: fontFamily.extrabold
  },
  phaseHint: { marginTop: 2, marginBottom: 6, lineHeight: 17 },
  phaseInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    padding: spacing.md,
    minHeight: 84,
    fontSize: fontSize.base,
    color: colors.ink,
    backgroundColor: colors.card,
    textAlignVertical: 'top',
    fontFamily: fontFamily.regular
  },
  phaseSaved: {
    marginTop: 4,
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.greenInk,
    fontFamily: fontFamily.bold
  },
  screen: { flex: 1, backgroundColor: colors.bg },
  centre: { alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg },
  flex: { flex: 1 },

  playerWrap: {
    marginTop: spacing.lg,
    borderRadius: radius.card,
    overflow: 'hidden',
    backgroundColor: colors.mediaBackdrop,
    aspectRatio: 3 / 4,
  },
  player: { width: '100%', height: '100%' },

  statedNote: {
    flexDirection: 'row',
    gap: spacing.sm,
    alignItems: 'flex-start',
    marginTop: spacing.md,
  },
  statedText: { flex: 1, lineHeight: 21 },
  /**
   * The stand-in for a player. Tinted rather than grey or black: nothing has
   * gone wrong here, so it must not read as a failed load or an empty frame.
   */
  remoteCard: { gap: spacing.sm, alignItems: 'flex-start' },
  /** Keeps layout stable while removing actions that cannot work. */
  hidden: { display: 'none' },

  actions: { flexDirection: 'row', gap: spacing.sm, marginTop: spacing.lg },

  summaryTop: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  badgeRow: { flexDirection: 'row', gap: spacing.xs, flexWrap: 'wrap' },

  group: { marginBottom: spacing.md },
  groupLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.inkSoft,
    marginBottom: 4,
    fontFamily: fontFamily.extrabold
  },
  groupValues: {
    fontSize: fontSize.base,
    color: colors.ink,
    lineHeight: fontSize.base * 1.5,
    fontFamily: fontFamily.regular
  },

  singleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  singlePill: { gap: 4 },
  singleLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.inkSoft,
    fontFamily: fontFamily.extrabold
  },
});
