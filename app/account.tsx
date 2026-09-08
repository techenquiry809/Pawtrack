/**
 * Account.
 *
 * Three destructive actions live here, and the difference between them is the
 * whole point of the screen — so each one says plainly what it does:
 *
 *   Sign out                    changes nothing about the data
 *   Remove this account's data  deletes local rows AND local video files
 *   Delete account              the above, everywhere, permanently
 *
 * Sign-out deliberately does not wipe. A different person signing in on this
 * phone sees their own records while the first user's survive for when they
 * come back, and — more importantly — an undrained outbox is not thrown away
 * by an action nobody thinks of as destructive.
 */

import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Body,
  Button,
  Card,
  Heading,
  Muted,
  ActionRow,
  NavRow,
  SectionTitle,
  Title,
} from '@/components/ui';
import { colors, fontFamily, fontSize, spacing } from '@/theme/tokens';
import { BackButton } from '@/components/BackButton';
import { Icon } from '@/components/Icon';
import { SignOutDialog } from '@/components/SignOutDialog';
import { ConfirmDialog } from '@/components/ConfirmDialog';
import { pendingWriteCount, useAuthStore } from '@/store/authStore';
import { useAppStore } from '@/store/appStore';
import { syncNow, lastSyncedAt } from '@/services/sync/worker';
import { clearConsentCache } from '@/services/consent';
import {
  isAppLockAvailable,
  isAppLockEnabled,
  setAppLockEnabled,
} from '@/services/appLock';
import {
  deleteAccount,
  removeAccountDataFromDevice,
} from '@/services/sync/localData';

type Confirm = null | 'signOut' | 'removeData' | 'deleteAccount';

export default function AccountScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const status = useAuthStore((s) => s.status);
  const user = useAuthStore((s) => s.user);
  const signOut = useAuthStore((s) => s.signOut);
  const refreshDogs = useAppStore((s) => s.refreshDogs);

  const [pending, setPending] = useState(0);
  const [lockAvailable, setLockAvailable] = useState(false);
  const [lockEnabled, setLockEnabled] = useState(false);
  const [confirm, setConfirm] = useState<Confirm>(null);
  /**
   * What the last manual sync did, in one line.
   *
   * ── WHY THIS EXISTS ───────────────────────────────────────────────────
   *
   * `syncNow` swallows its failures on purpose — a background sync that
   * cannot reach the server is not an error the owner needs interrupting for,
   * and services/sync/worker.ts documents exactly that. It is the right rule
   * for the sync that runs on its own.
   *
   * It was the wrong rule for a button. Pressing "Sync now" ran the sync, the
   * sync failed, `refresh()` re-read the same unchanged count, and the screen
   * came back byte-for-byte identical — same "27 records waiting to back up",
   * same button. There was no way to tell a sync that worked from one that
   * never left the phone, so the only sensible thing to do was press it again.
   * An action the owner explicitly asked for has to report what it did.
   */
  const [syncNote, setSyncNote] = useState<
    { tone: 'ok' | 'bad'; text: string } | null
  >(null);
  const [busy, setBusy] = useState(false);

  const refresh = useCallback(async () => {
    setPending(await pendingWriteCount());
    setLockAvailable(await isAppLockAvailable());
    setLockEnabled(await isAppLockEnabled());
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const onToggleLock = async (next: boolean) => {
    await setAppLockEnabled(next);
    setLockEnabled(next);
  };

  const onSyncNow = async () => {
    setBusy(true);
    setSyncNote(null);
    try {
      const summary = await syncNow('manual');
      await refresh();

      if (!summary) {
        // Null is a failed run. Say so, and say what it does NOT mean: an
        // owner reading "could not back up" on a medical diary needs telling
        // in the same breath that nothing was lost.
        setSyncNote({
          tone: 'bad',
          text: 'Could not back up just now. Nothing was lost — your records are still on this phone.',
        });
      } else if (summary.remaining > 0) {
        setSyncNote({
          tone: 'bad',
          text: `Partly backed up. ${summary.remaining} ${summary.remaining === 1 ? 'record is' : 'records are'} still waiting.`,
        });
      } else {
        setSyncNote({
          tone: 'ok',
          text:
            summary.pushed === 0
              ? 'Already up to date.'
              : `Backed up ${summary.pushed} ${summary.pushed === 1 ? 'record' : 'records'}.`,
        });
      }
    } finally {
      setBusy(false);
    }
  };

  const onRemoveData = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await removeAccountDataFromDevice(user.id);
      // The cached agreement is about this account on this device, so it must
      // not outlive the data it belonged to. The account's own record is
      // untouched — removing data from a phone is not withdrawing consent.
      await clearConsentCache(user.id);
      await signOut();
      await refreshDogs();
      router.replace('/(auth)/sign-in');
    } finally {
      setBusy(false);
    }
  };

  const onDeleteAccount = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await deleteAccount(user.id);
      await refreshDogs();
      router.replace('/(tabs)');
    } finally {
      setBusy(false);
    }
  };

  const synced = lastSyncedAt();

  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        {
          paddingTop: insets.top + spacing.md,
          paddingBottom: insets.bottom + spacing.xl,
        },
      ]}
    >
      <BackButton />
      <Title>Account</Title>

      {status === 'signed-in' && <SectionTitle>Backup</SectionTitle>}

      {status === 'signed-in' ? (
        <Card style={styles.block}>
          {/*
            An identity row, not a bare bold email. The rest of the app leads
            every row with a tinted glyph; this screen had none at all, which
            is most of why it read as a different app's settings page.
          */}
          <View style={styles.identity}>
            <View style={styles.identityGlyph}>
              <Icon name="profile" size="lg" color={colors.tealDeep} filled />
            </View>
            <View style={styles.flexOne}>
              <Text style={styles.email} numberOfLines={1}>
                {user?.email ?? 'Signed in'}
              </Text>
              <Muted style={styles.identityDetail}>
                {pending === 0
                  ? synced
                    ? `Backed up · last synced ${new Date(synced).toLocaleTimeString()}`
                    : 'Saved on this phone · first sync has not run yet'
                  : pending === 1
                    ? '1 record waiting to back up'
                    : `${pending} records waiting to back up`}
              </Muted>
            </View>
          </View>

          {/*
            `secondary`, not `ghost`. The outline variant is white on a white
            card — a hairline and a shadow were the only things saying this
            was a button at all. Tinted is the treatment this app already uses
            for an action sitting inside a card.
          */}
          <Button
            label="Sync now"
            variant="secondary"
            onPress={() => void onSyncNow()}
            loading={busy}
            disabled={busy}
          />

          {/*
            One line, under the button that caused it — not the shared
            ErrorNotice. That card is a panel with an icon, a heading and a
            retry, which is the right weight for "we could not send your code"
            and far too much for the outcome of a button the owner is standing
            in front of and can simply press again.
          */}
          {syncNote ? (
            <Text
              style={[styles.syncNote, syncNote.tone === 'bad' && styles.syncNoteBad]}
              accessibilityRole="alert"
            >
              {syncNote.text}
            </Text>
          ) : null}
        </Card>
      ) : (
        /*
          Reachable only for the moment between signing out and the route gate
          routing to sign-in. It is a transitional frame, not a destination, so
          it says what is happening rather than inviting an action the app is
          already taking. The old copy here offered an optional account and is
          gone with it.
        */
        <Card style={styles.block}>
          <Heading>Signing out…</Heading>
          <Muted style={styles.body}>Taking you back to sign in.</Muted>
        </Card>
      )}

      {status === 'signed-in' && <SectionTitle>Devices</SectionTitle>}
      {status === 'signed-in' && (
        <Card style={styles.list}>
          <NavRow
            icon="device"
            label="Your devices"
            detail="See what is signed in, and sign out a device"
            onPress={() => router.push('/devices')}
            last
          />
        </Card>
      )}

      {/* ---- App lock -------------------------------------------------- */}
      {lockAvailable && <SectionTitle>Security</SectionTitle>}
      {lockAvailable && (
        <Card style={styles.block}>
          <View style={styles.switchRow}>
            <View style={styles.switchText}>
              <Heading>Require Face ID to open</Heading>
              <Muted style={styles.body}>
                Protects your records if someone picks up your phone.
              </Muted>
            </View>
            <Switch value={lockEnabled} onValueChange={(v) => void onToggleLock(v)} />
          </View>
          {/*
            The reassurance that makes this safe to turn on. A lock on an
            emergency app is only acceptable because it can never fail closed
            and never needs a network.
          */}
          <Muted style={styles.body}>
            You can always fall back to your passcode, and this works with no
            signal. It never signs you out.
          </Muted>
        </Card>
      )}

      {/* ---- Destructive ----------------------------------------------- */}
      {/*
        A titled group, not three loose buttons.

        They used to be three identical white pills in a row, so "Sign out"
        and "Delete my account" — one of which is undoable in five seconds and
        one of which is not undoable at all — carried exactly the same visual
        weight, in the same shape, at the same size. The section title says
        what this part of the page is, one card groups the rows, and the two
        irreversible ones are red and say underneath what they actually do.
      */}
      {status === 'signed-in' && (
        <>
          {/*
            Signing out is NOT in the same group as the other two, and the
            grouping is the design.

            "Danger zone" held all three, so an action that loses nothing sat
            in a box labelled dangerous, next to one that erases a dog's
            entire medical history — and the label stopped meaning anything
            because two thirds of what it covered was safe. Sign out gets its
            own untitled card; the two that actually destroy something get a
            heading that says so, in the app's own plain voice rather than
            borrowed developer shorthand.
          */}
          <Card style={[styles.list, styles.signOutCard]}>
            <ActionRow
              label="Sign out"
              detail="Your records stay on this phone."
              onPress={() => setConfirm('signOut')}
              last
            />
          </Card>

          <SectionTitle>Deleting data</SectionTitle>
          <Card style={styles.list}>
            {/*
              Shortened from "Remove this account's data from this phone",
              which ran the full width of the card in red and made the row
              read as a warning banner rather than as a control. The scoping
              the long version carried — whose data, and that the account
              survives — is in the line underneath, where it is legible.
              The confirmation dialog still asks the long question.
            */}
            <ActionRow
              label="Remove data from this phone"
              detail="Keeps your account. Clears this device."
              tone="danger"
              onPress={() => setConfirm('removeData')}
            />
            <ActionRow
              label="Delete my account"
              detail="Permanent, on every device."
              tone="danger"
              onPress={() => setConfirm('deleteAccount')}
              last
            />
          </Card>

          {/*
            All three questions are dialogs now. They used to be a dialog for
            one and unfolding cards for the other two, on the same page — see
            components/ConfirmDialog.tsx.
          */}
          <SignOutDialog
            visible={confirm === 'signOut'}
            onCancel={() => setConfirm(null)}
            onSignedOut={async () => {
              setConfirm(null);
              await refreshDogs();
              // Straight to sign-in rather than the tabs. The gate would
              // redirect there anyway; going directly avoids a frame of the
              // signed-out app.
              router.replace('/(auth)/sign-in');
            }}
          />

          <ConfirmDialog
            visible={confirm === 'removeData'}
            title="Remove this account's data from this phone?"
            body={[
              'Deletes the records and the seizure videos stored here. Your account keeps everything that has been backed up, so you can sign in on another device and it will still be there.',
              'Anything not yet backed up will be lost. Use this when you are giving this phone to someone else.',
            ]}
            confirmLabel="Remove from this phone"
            busy={busy}
            onConfirm={() => void onRemoveData()}
            onCancel={() => setConfirm(null)}
          />

          <ConfirmDialog
            visible={confirm === 'deleteAccount'}
            title="Delete your account?"
            body={[
              'Everything is deleted permanently: every dog, every seizure record, every check-in, on every device, plus the videos stored on this phone. There is no way to get any of it back.',
              'If you want a copy first, cancel and export a vet report.',
            ]}
            confirmLabel="Delete everything"
            busy={busy}
            onConfirm={() => void onDeleteAccount()}
            onCancel={() => setConfirm(null)}
          />
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  /**
   * No `gap`.
   *
   * It used to be `spacing.lg`, which stacked on top of SectionTitle's own
   * 20pt top / 8pt bottom margins — so a heading sat 28pt above its card and
   * 40pt below the previous one, and the difference between "belongs to this
   * group" and "is a new group" was 12pt. Everything floated at roughly the
   * same distance from everything else.
   *
   * SectionTitle already encodes that rhythm correctly. Letting it do the job
   * alone is what makes a heading read as attached to the card beneath it.
   */
  page: { padding: spacing.lg },
  block: { gap: spacing.md },
  flexOne: { flex: 1 },

  /* ---- The identity row ------------------------------------------- */
  identity: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  identityGlyph: {
    width: 44,
    height: 44,
    // A circle: half of 44. Not a step on the radius scale, which would round
    // it into a squircle and break rank with the header avatars.
    borderRadius: 22,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tealTint,
  },
  email: {
    fontSize: fontSize.md,
    fontWeight: '700',
    color: colors.ink,
    fontFamily: fontFamily.bold,
  },
  identityDetail: { fontSize: fontSize.sm, marginTop: 1 },
  syncNote: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    color: colors.tealDeep,
    fontFamily: fontFamily.semibold,
    fontWeight: '600',
  },
  // Red on the failure, but the same size and place as the success line, so
  // the card does not resize depending on how the sync went.
  syncNoteBad: { color: colors.redDeep },
  list: { padding: 0, overflow: 'hidden' },
  // The one card with no heading above it, so it carries the gap a
  // SectionTitle would otherwise have contributed.
  signOutCard: { marginTop: spacing.lg },
  body: { lineHeight: 21 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchText: { flex: 1, gap: spacing.xs },
});
