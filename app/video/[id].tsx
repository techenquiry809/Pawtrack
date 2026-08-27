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
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useVideoPlayer, VideoView } from 'expo-video';

import {
  Body, Button, Card, Disclaimer, Heading, Muted, Pill, type PillTone,
} from '@/components/ui';
import { ScreenHeader, SectionRule, TextAction } from '@/components/form';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';
import * as videoRepo from '@/db/videoRepo';
import * as seizureRepo from '@/db/seizureRepo';
import { deleteVideoAssets, videoFileUri } from '@/services/videoService';
import { saveVideoToPhone, shareVideo } from '@/services/mediaExport';
import { formatDuration, formatInterval } from '@/utils/time';
import { CAPTURE_CONFIDENCE_LABEL, type SeizureWithVideos, type Video } from '@/types/domain';

export default function VideoDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [video, setVideo] = useState<Video | null>(null);
  const [seizure, setSeizure] = useState<SeizureWithVideos | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<null | 'saving' | 'sharing'>(null);

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
          action={<TextAction label="Back" onPress={() => router.back()} />}
        />
      </ScrollView>
    );
  }

  const stated = video.captureConfidence !== 'device';
  const when = new Date(video.timestamp);

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
        title={when.toLocaleDateString(undefined, {
          weekday: 'long',
          day: 'numeric',
          month: 'long',
        })}
        subtitle={`${when.toLocaleTimeString(undefined, {
          hour: 'numeric',
          minute: '2-digit',
        })} · ${CAPTURE_CONFIDENCE_LABEL[video.captureConfidence]}`}
        action={<TextAction label="Back" onPress={() => router.back()} />}
      />

      {/* --- Player ------------------------------------------------ */}
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
      <View style={styles.actions}>
        <Button
          label={busy === 'saving' ? 'Saving…' : 'Save to my phone'}
          loading={busy === 'saving'}
          onPress={onSave}
          style={styles.flex}
          accessibilityHint="Adds this video to your Photos app in a Paws Journal album"
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
        Videos are stored on this phone only. Nothing about your dog is uploaded
        anywhere.
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

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centre: { alignItems: 'center', justifyContent: 'center' },
  content: { paddingHorizontal: spacing.lg },
  flex: { flex: 1 },

  playerWrap: {
    marginTop: spacing.lg,
    borderRadius: radius.md,
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
  statedText: { flex: 1 },

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
  },
  groupValues: {
    fontSize: fontSize.base,
    color: colors.ink,
    lineHeight: fontSize.base * 1.5,
  },

  singleRow: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.md },
  singlePill: { gap: 4 },
  singleLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.inkSoft,
  },
});
