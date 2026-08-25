/**
 * Post-seizure questions. Uses progressive disclosure — the owner has just
 * been through something distressing, so this must not present as one giant
 * form.
 *
 * Everything on this screen is optional. The seizure and its duration are
 * already captured; nothing here may block the owner from reaching the save
 * step, and every answer stays editable later from the detail screen.
 */

import { useEffect, useState, type ReactNode } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body, Button, Card, Chip, ChipGroup, Heading, Muted, Pill, Title,
} from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';
import { useActiveSeizure } from '@/store/activeSeizureStore';
import { useActiveDog } from '@/store/appStore';
import * as seizureRepo from '@/db/seizureRepo';
import { formatDuration } from '@/utils/time';
import {
  POST_BEHAVIOR_OPTIONS, PRE_ICTAL_OPTIONS, SEVERITY_OPTIONS,
} from '@/types/domain';

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

  if (!draft) return null;

  const durationSec =
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
      keyboardShouldPersistTaps="handled"
    >
      <Title>Right after the seizure</Title>
      <Muted style={styles.intro}>
        Every question here is optional, and you can change any answer later.
      </Muted>

      {/* --- What we already recorded --------------------------------- */}
      <Card style={{ marginTop: spacing.md }}>
        <View style={styles.row}>
          <Heading>Duration</Heading>
          <Pill label={formatDuration(durationSec)} tone="teal" />
        </View>
        <Muted style={{ marginTop: 6 }}>
          {new Date(draft.startedAt).toLocaleTimeString(undefined, {
            hour: 'numeric', minute: '2-digit', second: '2-digit',
          })}
          {draft.endedAt !== null && (
            <>
              {' — '}
              {new Date(draft.endedAt).toLocaleTimeString(undefined, {
                hour: 'numeric', minute: '2-digit', second: '2-digit',
              })}
            </>
          )}
        </Muted>
        {sincePrevSec !== null && (
          <Muted style={{ marginTop: 6 }}>
            {formatDuration(sincePrevSec)} since the previous recorded seizure.
          </Muted>
        )}
      </Card>

      {/* --- Behaviour right now -------------------------------------- */}
      <Question>How is {dog?.name ?? 'your dog'} behaving now?</Question>
      <ChipGroup>
        {POST_BEHAVIOR_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={draft.postBehavior.includes(option)}
            onPress={() => toggleMulti('postBehavior', option)}
          />
        ))}
      </ChipGroup>

      {/* --- Pre-seizure signs ---------------------------------------- */}
      <Question>Anything unusual beforehand?</Question>
      <ChipGroup>
        {PRE_ICTAL_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={draft.preIctalObs.includes(option)}
            onPress={() => toggleMulti('preIctalObs', option)}
          />
        ))}
      </ChipGroup>
      <TextInput
        style={styles.input}
        value={draft.preIctalNote}
        onChangeText={(text) => setField('preIctalNote', text)}
        placeholder="Anything else you noticed beforehand (optional)"
        placeholderTextColor={colors.inkSoft}
        multiline
        accessibilityLabel="Notes about what you noticed before the seizure"
      />

      {/* --- Owner-observed severity ---------------------------------- */}
      <Question>How did it look to you?</Question>
      <Muted style={{ marginBottom: spacing.sm }}>
        This is your own impression, not a clinical grade. Your vet uses it as
        context alongside the timing and the video.
      </Muted>
      <ChipGroup>
        {SEVERITY_OPTIONS.map((option) => (
          <Chip
            key={option}
            label={option}
            selected={draft.severityOwner === option}
            onPress={() => setSingle('severityOwner', option)}
          />
        ))}
      </ChipGroup>

      {/* --- Notes ---------------------------------------------------- */}
      <Question>Notes</Question>
      <TextInput
        style={[styles.input, styles.inputTall]}
        value={draft.notes}
        onChangeText={(text) => setField('notes', text)}
        placeholder="Anything you want to remember or tell your vet (optional)"
        placeholderTextColor={colors.inkSoft}
        multiline
        accessibilityLabel="Notes about this seizure"
      />

      <Button
        label="Continue to recovery"
        large
        onPress={() => {
          beginRecovery();
          router.replace('/seizure/recovery');
        }}
        accessibilityHint="Starts tracking how long your dog takes to return to normal"
        style={{ marginTop: spacing.xl }}
      />
      <Muted style={styles.footNote}>
        Nothing is saved until the next step, where you can also finish
        immediately without tracking recovery.
      </Muted>
    </ScrollView>
  );
}

/** Question heading. The shared SectionTitle is tuned for card lists, not
 *  for questions the owner is being asked to answer. */
function Question({ children }: { children: ReactNode }) {
  return <Body style={styles.sectionLabel}>{children}</Body>;
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  intro: { marginTop: spacing.sm },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  sectionLabel: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
    marginTop: spacing.xl,
    marginBottom: spacing.sm,
  },

  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.md,
    paddingBottom: spacing.md,
    minHeight: 56,
    fontSize: fontSize.base,
    color: colors.ink,
    marginTop: spacing.md,
    textAlignVertical: 'top',
  },
  inputTall: { minHeight: 96 },

  footNote: { textAlign: 'center', marginTop: spacing.sm },
});
