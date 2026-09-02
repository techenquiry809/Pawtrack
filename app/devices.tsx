/**
 * Your devices.
 *
 * The visible half of the concurrent-session design. Signing in on a second
 * device never signs the first one out — see the reasoning at the top of
 * src/services/sync/devices.ts — so the control the owner gets is seeing what
 * is signed in and being able to revoke it themselves.
 *
 * The copy here is deliberately honest about the one-hour lag on revocation.
 * A security control that quietly overstates itself is worse than one that
 * explains its limits, because the owner makes real decisions on the strength
 * of believing it.
 */

import { useCallback, useEffect, useState } from 'react';
import { RefreshControl, ScrollView, StyleSheet, View } from 'react-native';
import {
  Body,
  Button,
  Card,
  EmptyState,
  Heading,
  Muted,
  Pill,
  Title,
} from '@/components/ui';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { colors, fontFamily, spacing } from '@/theme/tokens';
import { BackButton } from '@/components/BackButton';
import {
  listDevices,
  revokeDevice,
  signOutOtherDevices,
  type UserDevice,
} from '@/services/sync/devices';
import { useAuthStore } from '@/store/authStore';
import { syncNow } from '@/services/sync/worker';

/** "just now" / "2 days ago" — precision nobody needs beyond the day. */
function lastSeen(iso: string): string {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return 'unknown';

  const minutes = Math.floor((Date.now() - then) / 60_000);
  if (minutes < 2) return 'just now';
  if (minutes < 60) return `${minutes} minutes ago`;

  const hours = Math.floor(minutes / 60);
  if (hours < 24) return hours === 1 ? '1 hour ago' : `${hours} hours ago`;

  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? 'yesterday' : `${days} days ago`;

  const months = Math.floor(days / 30);
  return months === 1 ? '1 month ago' : `${months} months ago`;
}

export default function DevicesScreen() {
  const insets = useSafeAreaInsets();
  const status = useAuthStore((s) => s.status);

  const [devices, setDevices] = useState<UserDevice[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [confirmingOthers, setConfirmingOthers] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setDevices(await listDevices());
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRevoke = async (deviceId: string) => {
    setBusy(true);
    try {
      await revokeDevice(deviceId);
      await load();
    } finally {
      setBusy(false);
    }
  };

  const onSignOutOthers = async () => {
    setBusy(true);
    try {
      await signOutOtherDevices();
      setConfirmingOthers(false);
      await load();
      void syncNow('manual');
    } finally {
      setBusy(false);
    }
  };

  if (status !== 'signed-in') {
    return (
      <View style={[styles.page, { paddingTop: insets.top + spacing.md }]}>
        <BackButton />
        <Title>Your devices</Title>
        <EmptyState
          title="Not signed in"
          body="Sign in to see which devices are using your account."
        />
      </View>
    );
  }

  const others = devices.filter((d) => !d.isThisDevice && !d.revokedAt);

  return (
    <ScrollView
      contentContainerStyle={[
        styles.page,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
      refreshControl={
        <RefreshControl refreshing={loading} onRefresh={() => void load()} />
      }
    >
      <BackButton />
      <Title>Your devices</Title>

      <Muted style={styles.lede}>
        Your records sync to every device signed into your account. They all
        stay signed in — you will never be logged out of one because you used
        another.
      </Muted>

      {devices.length === 0 && !loading ? (
        <EmptyState
          title="No devices yet"
          body="This device will appear here after its first sync."
        />
      ) : (
        <Card style={styles.list}>
          {devices.map((device, index) => (
            <View
              key={device.deviceId}
              style={[styles.row, index > 0 && styles.rowDivider]}
            >
              <View style={styles.rowMain}>
                <View style={styles.rowTitle}>
                  <Body>{device.displayName}</Body>
                  {device.isThisDevice && <Pill label="This device" tone="teal" />}
                  {device.revokedAt && <Pill label="Signed out" tone="neutral" />}
                </View>
                <Muted>
                  {device.platform === 'ios' ? 'iOS' : 'Android'} ·{' '}
                  {device.revokedAt
                    ? `signed out ${lastSeen(device.revokedAt)}`
                    : `last synced ${lastSeen(device.lastSeenAt)}`}
                </Muted>
              </View>

              {!device.isThisDevice && !device.revokedAt && (
                <Button
                  label="Sign out"
                  variant="ghost"
                  onPress={() => void onRevoke(device.deviceId)}
                  disabled={busy}
                />
              )}
            </View>
          ))}
        </Card>
      )}

      {others.length > 0 && (
        <View style={styles.actions}>
          {confirmingOthers ? (
            <Card style={styles.danger}>
              <Heading>Sign out your other devices?</Heading>
              <Body style={styles.dangerBody}>
                {others.length === 1
                  ? '1 other device'
                  : `${others.length} other devices`}{' '}
                will be signed out. Any records they have not synced yet stay on
                those devices — they are uploaded next time someone signs in
                there, not lost.
              </Body>
              {/*
                The honest caveat. Supabase access tokens are stateless JWTs:
                revoking the refresh token is instant, but a token already
                issued keeps working until it expires. Saying "immediately"
                here would be a lie the owner might act on.
              */}
              <Muted style={styles.dangerBody}>
                This takes effect straight away for most things, and can take up
                to an hour to apply everywhere.
              </Muted>
              <Button
                label="Sign them out"
                variant="danger"
                onPress={() => void onSignOutOthers()}
                disabled={busy}
              />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setConfirmingOthers(false)}
                disabled={busy}
              />
            </Card>
          ) : (
            <>
              <Button
                label="Sign out my other devices"
                variant="ghost"
                onPress={() => setConfirmingOthers(true)}
                disabled={busy}
              />
              <Muted style={styles.actionNote}>
                Use this if you have lost a phone or signed in somewhere you
                should not have.
              </Muted>
            </>
          )}
        </View>
      )}

      <Card style={styles.explainer}>
        <Title style={styles.explainerTitle}>About seizure videos</Title>
        <Muted style={styles.actionNote}>
          Video files stay on the phone that recorded them — they are never
          uploaded. Every device sees that a recording exists and everything
          else about the seizure, but only the original phone can play it.
        </Muted>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  page: { padding: spacing.lg, gap: spacing.lg, paddingBottom: spacing.xl * 2 },
  lede: { lineHeight: 21 },
  list: { padding: 0 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    padding: spacing.md,
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: colors.line },
  rowMain: { flex: 1, gap: spacing.xs },
  rowTitle: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  actions: { gap: spacing.sm },
  actionNote: { lineHeight: 19 },
  danger: { backgroundColor: colors.redTint, gap: spacing.sm },
  dangerBody: { lineHeight: 21 },
  explainer: { gap: spacing.sm },
  explainerTitle: { fontSize: 17, fontFamily: fontFamily.regular },
});
