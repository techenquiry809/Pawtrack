/**
 * "You have records here that aren't in your account yet."
 *
 * ── WHY THIS IS A SCREEN AND NOT A SILENT MERGE ───────────────────────
 *
 * Merging is irreversible. If someone signs into an account that already has a
 * different dog, folding two animals' seizure histories together cannot be
 * undone — there is no field that says which dog a row came from afterwards,
 * and a vet report built from the merged set would be actively misleading.
 *
 * So the decision goes to the owner, with both dogs named in front of them.
 * The destructive branch is behind a second confirmation, because "keep only
 * what's in my account" means permanently deleting records that exist on no
 * other device and no server.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { router } from 'expo-router';
import { Body, Button, Card, Heading, Muted, Title } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';
import { useAuthStore } from '@/store/authStore';
import { useAppStore } from '@/store/appStore';
import { claimLocalData, discardUnclaimedData } from '@/services/sync/claim';
import { deleteVideoAssets } from '@/services/videoService';
import { syncNow } from '@/services/sync/worker';

export default function ClaimScreen() {
  const situation = useAuthStore((s) => s.pendingClaim);
  const user = useAuthStore((s) => s.user);
  const clearPendingClaim = useAuthStore((s) => s.clearPendingClaim);
  const refreshDogs = useAppStore((s) => s.refreshDogs);

  const [busy, setBusy] = useState(false);
  const [confirmingDiscard, setConfirmingDiscard] = useState(false);

  // Nothing to decide — the store cleared it, or the screen was reached
  // directly. Leaving would strand the user, so send them home.
  if (!situation || !user) {
    router.replace('/(tabs)');
    return null;
  }

  const localNames = situation.unclaimed.map((d) => d.name).join(', ');
  const accountNames = situation.inAccount.map((d) => d.name).join(', ');

  const finish = async () => {
    await refreshDogs();
    clearPendingClaim();
    router.replace('/(tabs)');
    void syncNow('sign-in');
  };

  const onKeepBoth = async () => {
    setBusy(true);
    try {
      await claimLocalData(user.id);
      await finish();
    } finally {
      setBusy(false);
    }
  };

  const onDiscardLocal = async () => {
    setBusy(true);
    try {
      const { orphanedFiles } = await discardUnclaimedData();
      // The rows are gone; the bytes are the part that exists nowhere else, so
      // they are removed explicitly rather than left orphaned on disk.
      for (const file of orphanedFiles) deleteVideoAssets(file);
      await finish();
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView contentContainerStyle={styles.page}>
      <View style={styles.header}>
        <Title>Records on this phone</Title>
        <Muted style={styles.lede}>
          Some records here aren&rsquo;t part of your account yet. Choose what
          to do with them before you carry on.
        </Muted>
      </View>

      <Card style={styles.compare}>
        <View style={styles.side}>
          <Heading>On this phone</Heading>
          <Body>{localNames || 'No dog'}</Body>
          <Muted>
            {situation.unclaimedRowCount === 1
              ? '1 record'
              : `${situation.unclaimedRowCount} records`}{' '}
            not yet in any account
          </Muted>
        </View>

        <View style={styles.rule} />

        <View style={styles.side}>
          <Heading>In your account</Heading>
          <Body>{accountNames || 'No dog'}</Body>
          <Muted>Synced from your other devices</Muted>
        </View>
      </Card>

      <View style={styles.actions}>
        <Button
          label={
            situation.unclaimed.length === 1
              ? `Add ${situation.unclaimed[0]?.name ?? 'these records'} to my account`
              : 'Add these records to my account'
          }
          onPress={() => void onKeepBoth()}
          disabled={busy}
          large
        />
        <Muted style={styles.actionNote}>
          Keeps everything. Both dogs will appear in your account and sync to
          your other devices.
        </Muted>
      </View>

      {/*
        Second confirmation. The first tap only reveals what is about to
        happen; nothing is deleted until the owner has read the consequence
        with the record count in it.
      */}
      {confirmingDiscard ? (
        <Card style={styles.danger}>
          <Heading>Delete these records permanently?</Heading>
          <Body style={styles.dangerBody}>
            {situation.unclaimedRowCount === 1
              ? '1 record'
              : `${situation.unclaimedRowCount} records`}{' '}
            for {localNames || 'this dog'} will be deleted from this phone,
            including any seizure videos. They are not in your account and are
            not on any other device, so this cannot be undone.
          </Body>
          <Button
            label="Delete them"
            variant="danger"
            onPress={() => void onDiscardLocal()}
            disabled={busy}
          />
          <Button
            label="Cancel"
            variant="ghost"
            onPress={() => setConfirmingDiscard(false)}
            disabled={busy}
          />
        </Card>
      ) : (
        <View style={styles.actions}>
          <Button
            label="Keep only what's in my account"
            variant="ghost"
            onPress={() => setConfirmingDiscard(true)}
            disabled={busy}
          />
          <Muted style={styles.actionNote}>
            Deletes the records on this phone. This cannot be undone.
          </Muted>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
  header: { gap: spacing.sm, marginTop: spacing.xl },
  lede: { lineHeight: 21 },
  compare: { gap: spacing.md },
  side: { gap: spacing.xs },
  rule: { height: 1, backgroundColor: colors.line },
  actions: { gap: spacing.sm },
  actionNote: { lineHeight: 19 },
  danger: { backgroundColor: colors.redTint, gap: spacing.sm },
  dangerBody: { lineHeight: 21 },
});
