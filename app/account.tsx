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
import { ScrollView, StyleSheet, Switch, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import {
  Body,
  Button,
  Card,
  Heading,
  Muted,
  NavRow,
  Title,
} from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';
import { BackButton } from '@/components/BackButton';
import { pendingWriteCount, useAuthStore } from '@/store/authStore';
import { useAppStore } from '@/store/appStore';
import { syncNow, lastSyncedAt } from '@/services/sync/worker';
import {
  isAppLockAvailable,
  isAppLockEnabled,
  setAppLockEnabled,
} from '@/services/appLock';
import {
  deleteAccount,
  removeAccountDataFromDevice,
} from '@/services/sync/localData';
import { resetAuthPrompt } from '@/services/authPrompt';

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

  const onSignOut = async () => {
    setBusy(true);
    try {
      await signOut();
      // Put the sign-in offer back on the table — the next person to pick up
      // this phone may well be a different one.
      await resetAuthPrompt();
      await refreshDogs();
      router.replace('/(tabs)');
    } finally {
      setBusy(false);
    }
  };

  const onSyncNow = async () => {
    setBusy(true);
    try {
      await syncNow('manual');
      await refresh();
    } finally {
      setBusy(false);
    }
  };

  const onRemoveData = async () => {
    if (!user) return;
    setBusy(true);
    try {
      await removeAccountDataFromDevice(user.id);
      await signOut();
      await resetAuthPrompt();
      await refreshDogs();
      router.replace('/(tabs)');
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

      {status === 'signed-in' ? (
        <Card style={styles.block}>
          <Heading>{user?.email ?? 'Signed in'}</Heading>
          <Muted>
            {pending === 0
              ? synced
                ? `Everything is backed up. Last synced ${new Date(synced).toLocaleTimeString()}.`
                : 'Everything is saved on this phone. First sync has not run yet.'
              : pending === 1
                ? '1 record has not been backed up yet.'
                : `${pending} records have not been backed up yet.`}
          </Muted>
          <Button
            label="Sync now"
            variant="ghost"
            onPress={() => void onSyncNow()}
            disabled={busy}
          />
        </Card>
      ) : (
        <Card style={styles.block}>
          <Heading>Not signed in</Heading>
          <Muted style={styles.body}>
            Your records are saved on this phone. Sign in to back them up and
            open them on another device — nothing recorded so far is lost.
          </Muted>
          <Button label="Sign in" onPress={() => router.push('/sign-in')} />
        </Card>
      )}

      {status === 'signed-in' && (
        <Card style={styles.list}>
          <NavRow
            label="Your devices"
            detail="See what is signed in, and sign out a device"
            onPress={() => router.push('/devices')}
            last
          />
        </Card>
      )}

      {/* ---- App lock -------------------------------------------------- */}
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
      {status === 'signed-in' && (
        <View style={styles.block}>
          {confirm === 'signOut' ? (
            <Card style={styles.warn}>
              <Heading>Sign out?</Heading>
              <Body style={styles.body}>
                {pending === 0
                  ? 'Your records stay on this phone and in your account.'
                  : `${pending === 1 ? '1 record has' : `${pending} records have`} not been backed up yet. They stay on this phone, and will upload next time you sign in.`}
              </Body>
              {pending > 0 && (
                <Button
                  label="Sync now first"
                  onPress={() => void onSyncNow()}
                  disabled={busy}
                />
              )}
              <Button
                label="Sign out"
                variant="ghost"
                onPress={() => void onSignOut()}
                disabled={busy}
              />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setConfirm(null)}
                disabled={busy}
              />
            </Card>
          ) : (
            <Button
              label="Sign out"
              variant="ghost"
              onPress={() => {
                void refresh();
                setConfirm('signOut');
              }}
            />
          )}

          {confirm === 'removeData' ? (
            <Card style={styles.danger}>
              <Heading>Remove this account&rsquo;s data from this phone?</Heading>
              <Body style={styles.body}>
                Deletes the records and the seizure videos stored here. Your
                account keeps everything that has been backed up, so you can
                sign in on another device and it will still be there.
              </Body>
              <Body style={styles.body}>
                Anything not yet backed up will be lost. Use this when you are
                giving this phone to someone else.
              </Body>
              <Button
                label="Remove from this phone"
                variant="danger"
                onPress={() => void onRemoveData()}
                disabled={busy}
              />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setConfirm(null)}
                disabled={busy}
              />
            </Card>
          ) : (
            <Button
              label="Remove this account's data from this phone"
              variant="ghost"
              onPress={() => setConfirm('removeData')}
            />
          )}

          {confirm === 'deleteAccount' ? (
            <Card style={styles.danger}>
              <Heading>Delete your account?</Heading>
              <Body style={styles.body}>
                Everything is deleted permanently: every dog, every seizure
                record, every check-in, on every device, plus the videos stored
                on this phone. There is no way to get any of it back.
              </Body>
              <Body style={styles.body}>
                If you want a copy first, cancel and export a vet report.
              </Body>
              <Button
                label="Delete everything"
                variant="danger"
                onPress={() => void onDeleteAccount()}
                disabled={busy}
              />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setConfirm(null)}
                disabled={busy}
              />
            </Card>
          ) : (
            <Button
              label="Delete my account"
              variant="ghost"
              onPress={() => setConfirm('deleteAccount')}
            />
          )}
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg },
  block: { gap: spacing.sm },
  list: { padding: 0 },
  body: { lineHeight: 21 },
  switchRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.md },
  switchText: { flex: 1, gap: spacing.xs },
  warn: { backgroundColor: colors.amberTint, gap: spacing.sm },
  danger: { backgroundColor: colors.redTint, gap: spacing.sm },
});
