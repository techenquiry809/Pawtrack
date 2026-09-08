/**
 * The sign-out confirmation, as a dialog rather than an unfolding card.
 *
 * ── WHAT IT REPLACES ──────────────────────────────────────────────────
 *
 * Both Settings and the Account screen used to expand an amber card in place:
 * a heading, a paragraph and THREE stacked full-width buttons — "Sync now
 * first", "Sign out", "Cancel" — pushed into the middle of a scrolling list,
 * shoving everything below it down the screen. Two of the three buttons were
 * the same size and weight as each other, the destructive one sat in the
 * middle where a thumb rests, and the whole thing could be scrolled half out
 * of view while still being the app's modal state.
 *
 * A question that must be answered before anything else happens is a dialog.
 * It arrives over the screen, takes the three answers, and leaves.
 *
 * ── "SYNC NOW FIRST" NOW FINISHES THE JOB ─────────────────────────────
 *
 * It used to sync and then put the owner back in front of the same three
 * buttons, so the actual sequence was: tap Sync, wait, tap Sign out. But
 * "sync now first" is not a thing anyone wants for its own sake — the word
 * *first* says what it is: the opening half of signing out. So it now runs
 * the sync, shows that the records made it, and signs out on its own.
 *
 * It does NOT do that if the sync fails or leaves anything behind. The whole
 * point of the button is not stranding records on a phone that is about to
 * lose access to them, and signing out anyway after a failed upload would do
 * precisely the thing the button exists to prevent. A failure stops and says
 * so, with the choice handed back.
 *
 * ── ONE COPY, TWO SCREENS ─────────────────────────────────────────────
 *
 * Settings and Account both offer this, and both had their own copy of the
 * markup, the counting and the handlers — already drifted (one used a danger
 * button, the other a ghost; one routed to sign-in afterwards, the other did
 * not). This is the single implementation; the screens supply only what to do
 * once the session has actually ended.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, StyleSheet, View } from 'react-native';

import { Body, Button, Heading, Muted } from '@/components/ui';
import { Dialog } from '@/components/Dialog';
import { Icon } from '@/components/Icon';
import { colors, fontFamily, fontSize, spacing } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';
import { pendingWriteCount, useAuthStore } from '@/store/authStore';
import { syncNow } from '@/services/sync/worker';

/**
 * How long the "backed up" tick is held before the sign-out runs.
 *
 * Long enough to be read as an outcome rather than a flicker, short enough
 * that it never feels like the app is making them wait for a decoration. The
 * sign-out itself is local and near-instant, so this IS the perceived
 * duration of the whole step.
 */
const CONFIRM_HOLD_MS = 950;

type Phase =
  | 'confirm'
  /** The manual sync is in flight. */
  | 'syncing'
  /** It worked and the queue is empty — the tick is playing. */
  | 'synced'
  /** It failed, or did not drain the queue. Nothing has been signed out. */
  | 'syncFailed'
  /** signOut() is in flight. */
  | 'signing';

export type SignOutDialogProps = {
  visible: boolean;
  /** Dismiss without signing out. */
  onCancel: () => void;
  /** Runs once the session has actually ended. */
  onSignedOut: () => void | Promise<void>;
};

export function SignOutDialog({ visible, onCancel, onSignedOut }: SignOutDialogProps) {
  const reduced = useReducedMotion();
  const signOut = useAuthStore((s) => s.signOut);

  const [phase, setPhase] = useState<Phase>('confirm');
  /**
   * Records not yet uploaded.
   *
   * Counted HERE, when the dialog opens, rather than taken as a prop. The
   * number decides which buttons appear and what the sentence says, and a
   * caller's copy can be minutes stale — the outbox drains in the background.
   * Starts at -1, meaning "not counted yet", so the dialog can hold its
   * wording until it knows rather than flashing "everything is backed up" at
   * someone with a full queue.
   */
  const [pending, setPending] = useState(-1);

  const tick = useRef(new Animated.Value(0)).current;

  /* ---- Open: reset, count, and pop in ------------------------------- */
  useEffect(() => {
    if (!visible) return;

    setPhase('confirm');
    setPending(-1);
    tick.setValue(0);

    let cancelled = false;
    void pendingWriteCount()
      .then((n) => {
        if (!cancelled) setPending(n);
      })
      // A count we cannot read must not block signing out. Zero is the safe
      // fallback for the LAYOUT (it hides the sync button); it is not a claim
      // that nothing is queued, which is why the body text says nothing about
      // backups when the count is unknown.
      .catch(() => {
        if (!cancelled) setPending(0);
      });

    return () => {
      cancelled = true;
    };
    // The card's own arrival is Dialog's job — see components/Dialog.tsx.
  }, [visible, tick]);

  const doSignOut = useCallback(async () => {
    setPhase('signing');
    try {
      await signOut();
      await onSignedOut();
    } catch (error) {
      console.error('[signout] failed', error);
      // The store surfaces its own error notice. Returning to the question is
      // the only honest state: the session is still live.
      setPhase('confirm');
    }
  }, [signOut, onSignedOut]);

  /* ---- The tick, then the sign-out ---------------------------------- */
  useEffect(() => {
    if (phase !== 'synced') return;

    if (reduced) {
      tick.setValue(1);
    } else {
      Animated.spring(tick, {
        toValue: 1,
        stiffness: 300,
        damping: 14,
        mass: 0.7,
        useNativeDriver: true,
      }).start();
    }

    const timer = setTimeout(() => void doSignOut(), reduced ? 300 : CONFIRM_HOLD_MS);
    return () => clearTimeout(timer);
  }, [phase, reduced, tick, doSignOut]);

  const onSyncFirst = async () => {
    setPhase('syncing');
    const summary = await syncNow('manual');

    // `null` is a failed run; `remaining` is what this account still has
    // queued afterwards. Either one means records would be left behind, which
    // is the exact thing this button exists to prevent — so neither signs out.
    if (!summary || summary.remaining > 0) {
      setPending(summary?.remaining ?? (await pendingWriteCount().catch(() => 0)));
      setPhase('syncFailed');
      return;
    }

    setPending(0);
    setPhase('synced');
  };

  const busy = phase === 'syncing' || phase === 'signing' || phase === 'synced';

  return (
    // Ignored while something is in flight: there is no safe point to abandon
    // a sign-out halfway.
    <Dialog visible={visible} onRequestClose={busy ? undefined : onCancel}>
      <>
          {phase === 'synced' || phase === 'signing' ? (
            <SyncedState tick={tick} signing={phase === 'signing'} />
          ) : (
            <>
              <Heading>Sign out?</Heading>

              <Body style={styles.body}>
                {phase === 'syncFailed'
                  ? pending === 0
                    ? 'The backup did not finish. Nothing was lost — your records are still on this phone.'
                    : `The backup did not finish. ${pending === 1 ? '1 record is' : `${pending} records are`} still waiting, and they stay on this phone until you sign in again.`
                  : pending <= 0
                    ? 'Your records stay on this phone and in your account.'
                    : `${pending === 1 ? '1 record has' : `${pending} records have`} not been backed up yet. They stay on this phone and will upload next time you sign in.`}
              </Body>

              {/*
                Offered only when there is something to send, and hidden once a
                run has already failed — a second identical attempt a moment
                later is unlikely to behave differently, and the honest choice
                at that point is to sign out anyway or to stay signed in.
              */}
              {pending > 0 && phase !== 'syncFailed' && (
                <Button
                  label="Back up, then sign out"
                  onPress={() => void onSyncFirst()}
                  loading={phase === 'syncing'}
                  disabled={busy}
                />
              )}

              <Button
                label={phase === 'syncFailed' ? 'Sign out anyway' : 'Sign out'}
                variant="danger"
                onPress={() => void doSignOut()}
                disabled={busy}
              />

              <Button
                label="Cancel"
                variant="ghost"
                onPress={onCancel}
                disabled={busy}
              />
            </>
          )}
      </>
    </Dialog>
  );
}

/* ------------------------------------------------------------------ */

/**
 * The moment between "backed up" and gone.
 *
 * Deliberately replaces the buttons rather than appearing above them. There is
 * nothing left to decide here — the decision was made when they pressed the
 * button — and leaving a live "Cancel" under a tick that is already signing
 * them out offers a choice the app is no longer honouring.
 */
function SyncedState({ tick, signing }: { tick: Animated.Value; signing: boolean }) {
  return (
    <View style={styles.done} accessible accessibilityRole="alert">
      <Animated.View
        style={[
          styles.tickCircle,
          {
            opacity: tick,
            transform: [
              { scale: tick.interpolate({ inputRange: [0, 1], outputRange: [0.5, 1] }) },
            ],
          },
        ]}
      >
        <Icon name="check" size="lg" color={colors.card} filled />
      </Animated.View>

      <Heading style={styles.doneTitle}>All backed up</Heading>
      <Muted style={styles.doneBody}>
        {signing ? 'Signing you out…' : 'Everything is safely in your account.'}
      </Muted>
    </View>
  );
}

const TICK_SIZE = 56;

const styles = StyleSheet.create({
  body: { marginBottom: spacing.xs, lineHeight: 21 },

  done: { alignItems: 'center', paddingVertical: spacing.sm, gap: spacing.sm },
  tickCircle: {
    width: TICK_SIZE,
    height: TICK_SIZE,
    // A circle: half of TICK_SIZE, not a step on the radius scale, which would
    // round this into a squircle.
    borderRadius: TICK_SIZE / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.green,
    marginBottom: spacing.xs,
  },
  doneTitle: { textAlign: 'center' },
  doneBody: {
    textAlign: 'center',
    fontSize: fontSize.sm,
    fontFamily: fontFamily.regular,
  },
});
