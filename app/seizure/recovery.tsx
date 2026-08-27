/**
 * Recovery tracking — and the end of the emergency flow.
 *
 * "Back to normal" auto-records recovery duration so the owner never has to
 * work out elapsed time themselves.
 *
 * This is the screen that finally writes the seizure to the database. Both
 * exits save; there is deliberately no path off this screen that discards the
 * record, because by this point the owner has already answered questions about
 * a seizure that really happened.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, AppState, ScrollView, StyleSheet, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, Disclaimer, Heading, Muted, Title } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';
import { useActiveSeizure } from '@/store/activeSeizureStore';
import { saveActiveSeizure } from '@/services/saveActiveSeizure';
import { formatClock, formatDuration } from '@/utils/time';

/** The finalize gate throws a ZodError carrying our mis-tap message. */
function isMisTap(error: unknown): boolean {
  return (
    error instanceof Error && error.message.includes('zero-second seizure')
  );
}

export default function RecoveryScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const draft = useActiveSeizure((s) => s.draft);
  // Two DIFFERENT actions, and the distinction is the whole bug that was here.
  // `clearDraft` lets go of a saved seizure; `discardDraft` throws an unsaved
  // one away and marks the row abandoned. This screen used to use the discard
  // action for both, so every seizure it saved was abandoned a statement later
  // and then filtered out of every read in the app.
  const clearDraft = useActiveSeizure((s) => s.clearDraft);
  const discardDraft = useActiveSeizure((s) => s.cancel);

  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // Guards against a double-tap writing the seizure twice. State would not
  // help here: two taps in the same frame both read the pre-update value.
  const savedRef = useRef(false);

  const recoveryStartedAt = draft?.recoveryStartedAt ?? null;

  // Same rule as the seizure timer: elapsed time is always recomputed from an
  // absolute timestamp. The interval only triggers a re-render.
  useEffect(() => {
    if (recoveryStartedAt === null) return;
    const tick = () =>
      setElapsed(Math.max(0, Math.floor((Date.now() - recoveryStartedAt) / 1000)));
    tick();
    const interval = setInterval(tick, 1000);
    const sub = AppState.addEventListener('change', (next) => {
      if (next === 'active') tick();
    });
    return () => {
      clearInterval(interval);
      sub.remove();
    };
  }, [recoveryStartedAt]);

  // If we somehow arrive with no draft there is nothing to save — get the
  // owner back to the main app rather than stranding them in a stack that has
  // no tab bar and no back gesture.
  useEffect(() => {
    if (!draft && !savedRef.current) router.replace('/(tabs)');
  }, [draft, router]);

  const finish = useCallback(
    async (recoveryEndedAt: number | null) => {
      if (!draft || savedRef.current) return;
      savedRef.current = true;
      setSaving(true);
      try {
        const { failedVideos } = await saveActiveSeizure(draft, recoveryEndedAt);
        clearDraft();
        router.replace('/(tabs)');
        if (failedVideos > 0) {
          Alert.alert(
            'Seizure saved',
            `The record was saved, but ${failedVideos} video${failedVideos === 1 ? '' : 's'} could not be attached. The recording is still on your phone.`,
          );
        }
      } catch (e) {
        console.error('[recovery] save failed', e);
        // Let the owner try again — do NOT clear the draft on failure, or the
        // seizure they just lived through is gone.
        savedRef.current = false;
        setSaving(false);

        // The finalize gate refuses a zero-second record: that is a double-tap,
        // not an event. Offering "try again" would loop forever, so offer the
        // action that actually resolves it.
        if (isMisTap(e)) {
          Alert.alert(
            'That looks like a mis-tap',
            'This recording is under a second long, so there is nothing to save. Discard it, or go back and keep timing if the seizure is still happening.',
            [
              { text: 'Keep it open', style: 'cancel' },
              {
                text: 'Discard',
                style: 'destructive',
                onPress: () => {
                  // A genuine discard: the record was refused, so the row must
                  // be marked abandoned rather than merely forgotten.
                  discardDraft();
                  router.replace('/(tabs)');
                },
              },
            ],
          );
          return;
        }

        Alert.alert(
          'Could not save this seizure',
          'Nothing has been lost. Please try again.',
        );
      }
    },
    [draft, clearDraft, discardDraft, router],
  );

  if (!draft) return null;

  const seizureDurationSec =
    draft.endedAt === null
      ? null
      : Math.max(0, Math.round((draft.endedAt - draft.startedAt) / 1000));

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <Title>Recovery</Title>
      <Muted style={styles.intro}>
        The seizure has stopped. This tracks how long it takes to get back to
        normal — vets find that as useful as the seizure itself.
      </Muted>

      <View
        style={styles.timerWrap}
        accessible
        accessibilityLabel={`Time since the seizure ended: ${Math.floor(elapsed / 60)} minutes ${elapsed % 60} seconds`}
        accessibilityLiveRegion="polite"
      >
        <Body style={styles.timer}>{formatClock(elapsed)}</Body>
        <Muted style={styles.timerCaption}>since the seizure ended</Muted>
      </View>

      <Card style={{ marginTop: spacing.lg }}>
        <Heading>This seizure</Heading>
        <Muted style={{ marginTop: 6 }}>
          Lasted {formatDuration(seizureDurationSec)}
          {draft.pendingVideos.length > 0 &&
            ` · ${draft.pendingVideos.length} video${draft.pendingVideos.length === 1 ? '' : 's'}`}
        </Muted>
      </Card>

      <Button
        label="Back to normal"
        large
        loading={saving}
        onPress={() => void finish(Date.now())}
        accessibilityHint="Records the recovery time and saves this seizure"
        style={{ marginTop: spacing.lg }}
      />
      <Button
        label="Save and finish later"
        variant="ghost"
        disabled={saving}
        onPress={() => void finish(null)}
        accessibilityHint="Saves this seizure without a recovery time. You can add it later from History."
        style={{ marginTop: spacing.sm }}
      />

      <Disclaimer>
        If your dog has not returned to normal, or you are worried about how
        they are doing, contact your veterinarian. This app records what you
        observe — it does not assess whether recovery is going well.
      </Disclaimer>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  intro: { marginTop: spacing.sm },

  timerWrap: { alignItems: 'center', marginTop: spacing.xl },
  timer: {
    fontSize: 56,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
    letterSpacing: -1,
  },
  timerCaption: { marginTop: 4 },
});
