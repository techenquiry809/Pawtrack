/**
 * LIVE SEIZURE SCREEN — the emergency interface.
 *
 * Layout hierarchy is deliberate and was specified by the product owner:
 *   TOP     timer, threshold banner, cluster warning, RECORD VIDEO
 *   MIDDLE  quick-tap observation chips
 *   BOTTOM  end-seizure button, then emergency contacts
 *
 * Record Video sits above the fold so it never needs scrolling to reach.
 * Emergency contacts sit last so they do not visually compete with the timer,
 * while remaining one scroll away.
 *
 * Nothing on this screen requires typing.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Alert, Linking, Pressable, ScrollView, StyleSheet, Text, View,
} from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Chip, ChipGroup, Muted, Pill } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';
import { useActiveDog, useAppStore } from '@/store/appStore';
import { useActiveSeizure } from '@/store/activeSeizureStore';
import { useSeizureTimer } from '@/hooks/useSeizureTimer';
import { deleteVideoFile, recordSeizureVideo } from '@/services/videoService';
import * as seizureRepo from '@/db/seizureRepo';
import { formatClock } from '@/utils/time';
import {
  AUTONOMIC_OPTIONS, AWARENESS_OPTIONS, MOVEMENT_OPTIONS, POSITION_OPTIONS,
} from '@/types/domain';

export default function LiveSeizureScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dog = useActiveDog();
  const settings = useAppStore((s) => s.settings);

  const draft = useActiveSeizure((s) => s.draft);
  const toggleMulti = useActiveSeizure((s) => s.toggleMulti);
  const setSingle = useActiveSeizure((s) => s.setSingle);
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
              deleteVideoFile(video.fileUri);
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
      if (video) addVideo(video);
    } catch (e) {
      Alert.alert(
        'Could not record video',
        e instanceof Error ? e.message : 'Please try again, or add a video later from History.',
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

  if (!draft || !dog) {
    // Defensive: if the store was cleared out from under us, get back to safety.
    return null;
  }

  // Cluster warning counts this seizure plus any already inside the window.
  const isPossibleCluster = clusterCount + 1 >= settings.clusterCount;

  return (
    <ScrollView
      style={[
        styles.screen,
        level === 'critical' && { backgroundColor: colors.redTint },
      ]}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      {/* --- Header --------------------------------------------------- */}
      <View style={styles.header}>
        <Pill label="● Recording" tone="red" />
        <Pressable
          onPress={onCancel}
          accessibilityRole="button"
          accessibilityLabel="Discard this seizure recording"
          style={styles.closeBtn}
        >
          <Text style={styles.closeIcon}>✕</Text>
        </Pressable>
      </View>

      {/* --- Timer ---------------------------------------------------- */}
      <View
        style={styles.timerWrap}
        accessible
        accessibilityLabel={`Seizure timer, ${Math.floor(elapsed / 60)} minutes ${elapsed % 60} seconds elapsed`}
        accessibilityLiveRegion="polite"
      >
        <Text
          style={[
            styles.timer,
            level === 'warn' && { color: colors.amber },
            level === 'critical' && { color: colors.red },
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

      {/* --- Threshold banners ---------------------------------------- */}
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
            Seizure has reached {settings.thresholdCritMin} minutes. This may be
            a veterinary emergency. Contact an emergency veterinarian
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

      {/* --- Record video (high priority, above the fold) -------------- */}
      <Button
        label={recording ? 'Recording…' : '⏺  Record video'}
        variant="danger"
        large
        loading={recording}
        onPress={onRecordVideo}
        accessibilityHint="Opens the camera to record this seizure"
        style={{ marginTop: spacing.md }}
      />
      {draft.pendingVideos.length > 0 ? (
        <Muted style={styles.centreNote}>
          {draft.pendingVideos.length} video
          {draft.pendingVideos.length === 1 ? '' : 's'} attached to this seizure
        </Muted>
      ) : (
        <Muted style={styles.centreNote}>Only record if it is safe to do so.</Muted>
      )}

      {/* --- Observations --------------------------------------------- */}
      <Text style={styles.sectionLabel}>QUICK OBSERVATIONS (OPTIONAL)</Text>

      <Text style={styles.groupLabel}>Movement</Text>
      <ChipGroup>
        {MOVEMENT_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={draft.ictalObs.includes(option)}
            onPress={() => toggleMulti('ictalObs', option)}
          />
        ))}
      </ChipGroup>

      <Text style={styles.groupLabel}>Awareness</Text>
      <ChipGroup>
        {AWARENESS_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={draft.awareness === option}
            onPress={() => setSingle('awareness', option)}
          />
        ))}
      </ChipGroup>

      <Text style={styles.groupLabel}>Autonomic signs</Text>
      <ChipGroup>
        {AUTONOMIC_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={draft.autonomic.includes(option)}
            onPress={() => toggleMulti('autonomic', option)}
          />
        ))}
      </ChipGroup>

      <Text style={styles.groupLabel}>Body position</Text>
      <ChipGroup>
        {POSITION_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={draft.position === option}
            onPress={() => setSingle('position', option)}
          />
        ))}
      </ChipGroup>

      {/* --- End seizure ---------------------------------------------- */}
      <Button
        label="Seizure ended — stop timer"
        variant="danger"
        large
        onPress={() => {
          endSeizure();
          router.replace('/seizure/post');
        }}
        style={{ marginTop: spacing.xl }}
      />
      <Muted style={styles.safetyNote}>
        Your and your dog&apos;s safety come first. Avoid touching the mouth or
        restraining your dog during a seizure.
      </Muted>

      {/* --- Emergency contacts (bottom, by design) ------------------- */}
      <Text style={styles.sectionLabel}>EMERGENCY CONTACTS</Text>
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
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  flex: { flex: 1 },

  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  closeBtn: {
    width: 44, height: 44, borderRadius: 22,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: colors.card, borderWidth: 1, borderColor: colors.line,
  },
  closeIcon: { fontSize: 18, color: colors.ink },

  timerWrap: { alignItems: 'center', marginTop: spacing.lg },
  timer: {
    fontSize: 68,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'], // stops the digits jittering each second
    letterSpacing: -1,
  },
  timerCaption: { marginTop: 4, textAlign: 'center' },

  banner: {
    flexDirection: 'row',
    gap: spacing.sm,
    borderRadius: radius.md,
    padding: spacing.md,
    marginTop: spacing.md,
    alignItems: 'flex-start',
  },
  bannerIcon: { fontSize: 16 },
  bannerWarn: { backgroundColor: colors.amberTint },
  bannerWarnText: { color: colors.amberInk, flex: 1, fontWeight: '600' },
  bannerCrit: { backgroundColor: colors.red },
  bannerCritText: { color: '#fff', flex: 1, fontWeight: '700' },

  centreNote: { textAlign: 'center', marginTop: spacing.sm },
  safetyNote: { textAlign: 'center', marginTop: spacing.sm },

  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.1,
    color: colors.inkSoft,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },
  groupLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    color: colors.inkSoft,
    textTransform: 'uppercase',
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },

  callRow: { flexDirection: 'row', gap: spacing.sm },
});
