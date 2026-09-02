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
import { colors, fontFamily, fontSize, spacing } from '@/theme/tokens';
import { useActiveSeizure } from '@/store/activeSeizureStore';
import { useActiveDog } from '@/store/appStore';
import { saveActiveSeizure } from '@/services/saveActiveSeizure';
import { syncAfterSeizure } from '@/services/sync/worker';
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
  const dog = useActiveDog();
  // Two DIFFERENT actions, and the distinction is the whole bug that was here.
  // `clearDraft` lets go of a saved seizure; `discardDraft` throws an unsaved
  // one away and marks the row abandoned. This screen used to use the discard
  // action for both, so every seizure it saved was abandoned a statement later
  // and then filtered out of every read in the app.
  const clearDraft = useActiveSeizure((s) => s.clearDraft);
  const discardDraft = useActiveSeizure((s) => s.cancel);

  const [saving, setSaving] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const dogName = dog?.name ?? 'your dog';
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

        // The one write worth pushing immediately rather than waiting for the
        // next foreground. This is the record the whole app exists to keep,
        // and by the next natural sync the phone could be flat, lost, or in a
        // waiting room with no signal. Deliberately not awaited: the owner has
        // just finished a seizure and is not waiting on a network round trip.
        void syncAfterSeizure();
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
        The seizure has stopped. The last thing to record is when {dogName} is
        back to their normal self — vets find that as useful as the seizure.
      </Muted>

      {/*
        ── WHY THE TWO NUMBERS ARE PAIRED AND LABELLED ──────────────────

        This screen used to show a large bare "00:07" above a card reading
        "Lasted 19s", with nothing tying them together. Two elapsed times, both
        in the same units, neither saying which was which — and the big one was
        the one that had NOT finished. Owners read the prominent number as the
        seizure length, which is the single most important figure in the app to
        get wrong.

        Side by side, each under its own label, the comparison is the point:
        one is finished, one is still running.
      */}
      <Card style={styles.stats}>
        <View style={styles.stat}>
          <Muted style={styles.statLabel}>Seizure lasted</Muted>
          <Body style={styles.statValue}>{formatDuration(seizureDurationSec)}</Body>
        </View>
        <View style={styles.statDivider} />
        <View
          style={styles.stat}
          accessible
          accessibilityLabel={`Recovering for ${Math.floor(elapsed / 60)} minutes ${elapsed % 60} seconds`}
          accessibilityLiveRegion="polite"
        >
          <Muted style={styles.statLabel}>Recovering for</Muted>
          <Body style={[styles.statValue, styles.statLive]}>{formatClock(elapsed)}</Body>
        </View>
      </Card>

      {draft.pendingVideos.length > 0 ? (
        <Muted style={styles.videoNote}>
          {draft.pendingVideos.length} video
          {draft.pendingVideos.length === 1 ? '' : 's'} will be saved with this record.
        </Muted>
      ) : null}

      {/* The screen asks one question, and the two buttons are its two
          answers. Previously the buttons were "Back to normal" and "Save and
          finish later" — a statement and an instruction, neither of which said
          what pressing it would do. */}
      <Heading style={styles.question}>Is {dogName} back to normal?</Heading>

      <Button
        label="Yes, back to normal now"
        large
        loading={saving}
        onPress={() => void finish(Date.now())}
        accessibilityHint="Records how long recovery took and saves this seizure"
        style={styles.primary}
      />
      {/*
        "Not yet, I'll add this later" promised something the app cannot do.
        There is no editor: seizure detail is read-only and says so ("Editing
        individual fields is coming"), so an owner who took that button at its
        word would go looking for a way back in and find none.

        The label now states the only thing that actually happens — the record
        is saved, without a recovery time. That is a complete, honest answer to
        the question above it, and it stops the screen from writing a cheque
        the rest of the app does not honour.
      */}
      <Button
        label="Save without recovery time"
        variant="ghost"
        disabled={saving}
        onPress={() => void finish(null)}
        accessibilityHint="Saves this seizure now. Recovery length is left blank rather than guessed."
        style={styles.secondary}
      />

      {/*
        The reassurance is the fix for the real fear this screen created: an
        owner who could not tell whether leaving would lose the seizure they
        had just lived through. Both buttons save. Saying so is what makes
        "not yet" a usable answer instead of a risk.
      */}
      <View style={styles.assure}>
        <Muted style={styles.assureLine}>
          The seizure is saved either way. This step only adds how long recovery
          took.
        </Muted>
        <Muted style={styles.assureLine}>
          You can close the app and come back — the timer counts from when the
          seizure ended, not from when this screen opened.
        </Muted>
      </View>

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

  stats: {
    flexDirection: 'row',
    alignItems: 'stretch',
    marginTop: spacing.lg,
    paddingVertical: spacing.md,
  },
  stat: { flex: 1, alignItems: 'center', gap: 2 },
  statLabel: { fontSize: fontSize.sm, textAlign: 'center' },
  statValue: {
    fontSize: fontSize.lg,
    color: colors.ink,
    fontFamily: fontFamily.bold,
    fontVariant: ['tabular-nums'],
  },
  /** The running one, tinted so the eye can tell it apart at a glance. */
  statLive: { color: colors.tealDeep },
  statDivider: { width: 1, backgroundColor: colors.line, marginHorizontal: spacing.sm },
  videoNote: { marginTop: spacing.sm, textAlign: 'center' },
  question: { marginTop: spacing.xl, textAlign: 'center' },
  primary: { marginTop: spacing.md },
  secondary: { marginTop: spacing.sm },
  assure: { marginTop: spacing.md, gap: spacing.xs },
  assureLine: { fontSize: fontSize.sm, textAlign: 'center' },

});
