/**
 * Post-seizure questions.
 *
 * Everything here is optional. The seizure and its duration are already
 * captured; nothing on this screen may block the owner from reaching the save
 * step, and every answer stays editable later from the detail screen.
 *
 * ── WHAT THE REDESIGN CHANGED, AND WHY ────────────────────────────────
 *
 * 1. THE COMMIT ACTION IS PINNED. It used to sit at the bottom of a form four
 *    scrolls long. An owner who wanted to answer nothing — which is allowed —
 *    still had to scroll past every question to leave. It is now an ActionBar.
 *
 * 2. THERE IS A VISIBLE END. A long optional questionnaire with no sense of
 *    how much remains reads as a demand rather than an offer, which is exactly
 *    wrong five minutes after a seizure. StepTrail names the three phases.
 *
 * 3. THE CHIP WALLS ARE GROUPED AND COUNTED. Selection state used to be
 *    invisible without reading every chip; each group now carries its own
 *    count. See components/form.tsx for the two-level label system.
 *
 * 4. THE QUESTIONS MOVED OUT. They are shared with the import flow now — see
 *    components/ObservationFields.tsx. Three screens asking the same questions
 *    from three copies of the option arrays was a drift waiting to happen.
 *
 * 5. "827m 33s" IS FIXED. The gap since the previous seizure is an interval,
 *    not a duration, and now uses formatInterval.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, Card, Muted, Pill } from '@/components/ui';
import { ActionBar, ScreenHeader, SectionRule, StepTrail } from '@/components/form';
import {
  AftermathFields,
  type MultiField,
  type ObservationValue,
  type SingleField,
  type TextField,
} from '@/components/ObservationFields';
import { colors, fontSize, spacing } from '@/theme/tokens';
import { useActiveSeizure } from '@/store/activeSeizureStore';
import { useActiveDog } from '@/store/appStore';
import * as seizureRepo from '@/db/seizureRepo';
import { formatDuration, formatInterval } from '@/utils/time';

const STEPS = ['During', 'Afterwards', 'Recovery'];

export default function PostSeizureScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const dog = useActiveDog();
  const draft = useActiveSeizure((s) => s.draft);
  const toggleMulti = useActiveSeizure((s) => s.toggleMulti);
  const setSingle = useActiveSeizure((s) => s.setSingle);
  const setField = useActiveSeizure((s) => s.setField);
  const beginRecovery = useActiveSeizure((s) => s.beginRecovery);

  const [sincePrevSec, setSincePrevSec] = useState<number | null>(null);

  const dogId = draft?.dogId;
  const startedAt = draft?.startedAt;

  useEffect(() => {
    if (!dogId || startedAt === undefined) return;
    let cancelled = false;
    seizureRepo
      .getMostRecentSeizure(dogId, startedAt)
      .then((prev) => {
        if (cancelled || !prev) return;
        setSincePrevSec(Math.round((startedAt - prev.start) / 1000));
      })
      .catch((e) => console.error('[post] previous-seizure lookup failed', e));
    return () => {
      cancelled = true;
    };
  }, [dogId, startedAt]);

  // If the draft vanished (force-quit, or the flow was discarded) there is
  // nothing to ask about. Never leave the owner on a dead screen inside the
  // emergency stack — it has no tab bar and no back gesture.
  useEffect(() => {
    if (!draft) router.replace('/(tabs)');
  }, [draft, router]);

  /**
   * Adapts the zustand draft to the plain-value interface the shared fields
   * expect. The import flow passes local state through the same shape.
   */
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

  const onContinue = useCallback(() => {
    beginRecovery();
    router.replace('/seizure/recovery');
  }, [beginRecovery, router]);

  if (!draft || !value) return null;

  const durationSec =
    draft.endedAt === null
      ? null
      : Math.max(0, Math.round((draft.endedAt - draft.startedAt) / 1000));

  const answered =
    value.postBehavior.length +
    value.preIctalObs.length +
    (value.severityOwner ? 1 : 0) +
    (value.preIctalNote ? 1 : 0) +
    (value.notes ? 1 : 0);

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
          eyebrow="Step 2 of 3"
          title="Right after the seizure"
          subtitle="Every question here is optional, and you can change any answer later."
        />
        <StepTrail steps={STEPS} current={1} />

        {/* --- What has already been captured ----------------------- */}
        <SectionRule label="Already recorded" />
        <Card>
          <View style={styles.durationRow}>
            <Text style={styles.durationValue}>
              {formatDuration(durationSec)}
            </Text>
            <Pill label="Timed in app" tone="teal" />
          </View>

          <View style={styles.timeline}>
            <TimeMark label="Started" epochMs={draft.startedAt} />
            <View style={styles.timelineLine} />
            <TimeMark label="Ended" epochMs={draft.endedAt} />
          </View>

          {sincePrevSec !== null ? (
            <Muted style={styles.since}>
              {formatInterval(sincePrevSec)} since the previous recorded seizure.
            </Muted>
          ) : (
            <Muted style={styles.since}>
              This is the first seizure recorded for {dog?.name ?? 'your dog'}.
            </Muted>
          )}

          {draft.pendingVideos.length > 0 ? (
            <Muted style={styles.since}>
              {draft.pendingVideos.length} video
              {draft.pendingVideos.length === 1 ? '' : 's'} will be saved with
              this record.
            </Muted>
          ) : null}
        </Card>

        {/* --- The questions ---------------------------------------- */}
        <AftermathFields
          value={value}
          on={handlers}
          dogName={dog?.name ?? 'your dog'}
        />
      </ScrollView>

      <ActionBar bottomInset={insets.bottom}>
        <Button
          label="Continue to recovery"
          large
          onPress={onContinue}
          accessibilityHint="Starts tracking how long your dog takes to return to normal"
        />
        <Muted style={styles.footNote}>
          {answered === 0
            ? 'You can skip all of this — nothing here is required.'
            : `${answered} answer${answered === 1 ? '' : 's'} so far. Nothing is saved until the next step.`}
        </Muted>
      </ActionBar>
    </View>
  );
}

/* ------------------------------------------------------------------ */

/**
 * One end of the seizure. Seconds are shown deliberately: this is the one
 * place in the app where they were measured rather than recalled, and dropping
 * them would make a stopwatch reading look like an estimate.
 */
function TimeMark({ label, epochMs }: { label: string; epochMs: number | null }) {
  return (
    <View style={styles.mark}>
      <Text style={styles.markLabel}>{label}</Text>
      <Text style={styles.markValue}>
        {epochMs === null
          ? '—'
          : new Date(epochMs).toLocaleTimeString(undefined, {
              hour: 'numeric',
              minute: '2-digit',
              second: '2-digit',
            })}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },

  durationRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  durationValue: {
    fontSize: fontSize.xl,
    fontWeight: '800',
    color: colors.ink,
    letterSpacing: -0.6,
    fontVariant: ['tabular-nums'],
  },

  timeline: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.md,
  },
  timelineLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.line,
  },
  mark: { gap: 2 },
  markLabel: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 1,
    textTransform: 'uppercase',
    color: colors.inkSoft,
  },
  markValue: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },

  since: { marginTop: spacing.md },
  footNote: { textAlign: 'center' },
});
