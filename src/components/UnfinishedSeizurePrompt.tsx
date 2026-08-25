/**
 * Shown when the app finds a seizure row still marked `in_progress`, meaning we
 * died partway through capturing it.
 *
 * Two deliberate decisions:
 *
 * 1. We never recover silently. An owner who is not told the record is
 *    incomplete will show it to a vet as if it were whole. Being visible about
 *    the gap is the point.
 *
 * 2. Nothing is destroyed by default, and there is no dismiss-by-tapping-
 *    outside. The person reading this may be exhausted and upset; the only ways
 *    out are labelled, deliberate choices.
 *
 * Copy note: the actions are named for what happens, not for how the system
 * works. "Save what we have" beats "Salvage partial record".
 */

import { useCallback, useEffect, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, View } from 'react-native';

import { Body, Heading, Muted } from '@/components/ui';
import { colors, fontSize, radius, spacing, MIN_TOUCH_TARGET } from '@/theme/tokens';
import * as seizureRepo from '@/db/seizureRepo';
import { useActiveSeizure } from '@/store/activeSeizureStore';
import { useAppStore } from '@/store/appStore';

function formatStartedAt(epochMs: number): string {
  const d = new Date(epochMs);
  const time = d.toLocaleTimeString(undefined, {
    hour: 'numeric',
    minute: '2-digit',
  });
  if (new Date().toDateString() === d.toDateString()) return `${time} today`;
  return `${time} on ${d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
  })}`;
}

export function UnfinishedSeizurePrompt() {
  const hydrated = useAppStore((s) => s.hydrated);
  const activeDraft = useActiveSeizure((s) => s.draft);

  const [orphan, setOrphan] = useState<seizureRepo.UnfinishedSeizure | null>(null);
  const [busy, setBusy] = useState(false);

  const check = useCallback(async () => {
    try {
      setOrphan(await seizureRepo.findUnfinishedSeizure());
    } catch (error) {
      console.error('[recovery] orphan lookup failed', error);
    }
  }, []);

  // Check on mount and on every return to the foreground. The foreground case
  // is the one that matters: iOS kills backgrounded apps, and the owner's next
  // interaction is a resume, not a cold launch.
  useEffect(() => {
    if (!hydrated) return;
    void check();
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') void check();
    });
    return () => sub.remove();
  }, [check, hydrated]);

  // A seizure being recorded RIGHT NOW is an in_progress row too. Never prompt
  // about the one the owner is actively living through.
  if (!orphan || activeDraft) return null;

  const name = orphan.dogName ?? 'your dog';

  const run = async (action: () => Promise<void>) => {
    setBusy(true);
    try {
      await action();
      setOrphan(null);
    } catch (error) {
      console.error('[recovery] action failed', error);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={() => {}}>
      <View style={styles.scrim}>
        <View style={styles.card}>
          <Heading>An unfinished recording</Heading>

          <Body style={styles.body}>
            {name}&apos;s seizure from {formatStartedAt(orphan.startedAtUtc)} was
            never finished. The app closed before you reached the recovery step,
            so some details are missing.
          </Body>

          {/*
            There is deliberately NO "Finish it now" action yet.
            app/seizure-detail/[id].tsx is still a placeholder, so routing there
            would leave the row `in_progress` — and this prompt would reappear
            on every foreground, forever. Per the project's own release gate, a
            control that implies a capability does not ship before the
            capability exists. Add it in the same PR as the detail editor.
          */}
          <Pressable
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Save what we have"
            accessibilityHint="Keeps the record. Duration will be marked as an estimate."
            style={({ pressed }) => [
              styles.action,
              styles.primary,
              pressed && styles.pressed,
            ]}
            onPress={() => run(() => seizureRepo.salvageSeizure(orphan))}
          >
            <Body style={styles.primaryLabel}>Save what we have</Body>
            <Muted style={styles.primaryHint}>
              Duration will be marked as an estimate
            </Muted>
          </Pressable>

          <Pressable
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel="Discard this recording"
            style={({ pressed }) => [styles.action, styles.ghost, pressed && styles.pressed]}
            onPress={() => run(() => seizureRepo.discardSeizure(orphan.id))}
          >
            <Body style={styles.label}>Discard it</Body>
            <Muted style={styles.hint}>If this was started by mistake</Muted>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    backgroundColor: 'rgba(32,41,58,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  body: { marginBottom: spacing.sm, lineHeight: 21 },
  action: {
    minHeight: MIN_TOUCH_TARGET,
    justifyContent: 'center',
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.sm,
  },
  primary: { backgroundColor: colors.teal, alignItems: 'center' },
  primaryLabel: { color: '#fff', fontWeight: '700', fontSize: fontSize.md },
  primaryHint: { color: '#fff', opacity: 0.85, marginTop: 2, textAlign: 'center' },
  ghost: { borderWidth: 1, borderColor: colors.line },
  pressed: { opacity: 0.75 },
  label: { fontWeight: '600' },
  hint: { marginTop: 2 },
});
