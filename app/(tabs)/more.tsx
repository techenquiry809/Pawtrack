/**
 * Settings — the settings hub.
 *
 * The route is still `more` for deep-link stability; only the label changed.
 *
 * ── WHY THIS IS NOT A LIST OF LINKS ───────────────────────────────────
 *
 * The spec asked for navigation rows to profile, emergency-plan, medications,
 * vet-report and settings. Three of those five routes DO NOT EXIST
 * (/profile, /medications, /vet-report), and a nav row that opens nothing is
 * worse than an absent one — the owner learns the app is unreliable at the
 * moment they are looking for help.
 *
 * So this screen links to what exists and IMPLEMENTS what it can. The seizure
 * thresholds and haptics are fully backed by `appStore.updateSettings`, which
 * validates through Zod, so they are real controls here rather than a link to
 * a settings screen that would only contain them.
 *
 * ── THE THRESHOLDS ARE SAFETY-CRITICAL ────────────────────────────────
 *
 * These drive the warning and emergency banners on the live seizure screen.
 * They are adjustable because veterinary care plans genuinely differ, but the
 * defaults reflect widely-cited guidance and the copy never suggests changing
 * them. The app must not imply that a longer threshold is safer.
 */

import { useCallback, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body, Button, Card, Disclaimer, Heading, Muted, NavRow, Pill, SectionTitle, Title,
} from '@/components/ui';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, spacing } from '@/theme/tokens';
import { useChromeMetrics } from '@/theme/chrome';
import { useActiveDog, useAppStore } from '@/store/appStore';
import { pendingWriteCount, useAuthStore } from '@/store/authStore';
import { syncNow } from '@/services/sync/worker';
import { resetAuthPrompt } from '@/services/authPrompt';
import { breedDisplay } from '@/db/dogRepo';
import { DogAvatar } from '@/components/ProfileHeader';
import { Icon } from '@/components/Icon';
import * as seizureRepo from '@/db/seizureRepo';
import * as checkinRepo from '@/db/checkinRepo';
import { DEFAULT_SETTINGS } from '@/types/domain';

export default function MoreScreen() {
  const insets = useSafeAreaInsets();
  const { contentClearance } = useChromeMetrics();
  const router = useRouter();

  const dog = useActiveDog();
  const dogs = useAppStore((s) => s.dogs);
  const activeDogId = useAppStore((s) => s.activeDogId);
  const setActiveDog = useAppStore((s) => s.setActiveDog);
  const settings = useAppStore((s) => s.settings);
  const updateSettings = useAppStore((s) => s.updateSettings);

  const [counts, setCounts] = useState<{ seizures: number; checkins: number } | null>(null);

  const authStatus = useAuthStore((s) => s.status);
  const userEmail = useAuthStore((s) => s.user?.email ?? null);
  const [pending, setPending] = useState(0);

  const signOut = useAuthStore((s) => s.signOut);
  const refreshDogs = useAppStore((s) => s.refreshDogs);
  const [confirmSignOut, setConfirmSignOut] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  const refreshPending = useCallback(async () => {
    setPending(await pendingWriteCount());
  }, []);

  const onSyncFirst = async () => {
    setSigningOut(true);
    try {
      await syncNow('manual');
      await refreshPending();
    } finally {
      setSigningOut(false);
    }
  };

  const onSignOut = async () => {
    setSigningOut(true);
    try {
      await signOut();
      // Put the sign-in offer back on the table — the next person to pick up
      // this phone may well be a different one.
      await resetAuthPrompt();
      await refreshDogs();
      setConfirmSignOut(false);
    } finally {
      setSigningOut(false);
    }
  };

  const accountLabel = authStatus === 'signed-in' ? 'Account' : 'Sign in';
  const accountDetail =
    authStatus === 'signed-in'
      ? pending === 0
        ? (userEmail ?? 'Backed up')
        : `${pending} record${pending === 1 ? '' : 's'} waiting to back up`
      : 'Back up your records and use them on another device';

  const dogId = dog?.id;

  // Refreshed on focus rather than on an interval: the number only changes as
  // a result of the owner's own writes or a sync, and both of those have
  // finished by the time this screen is looked at again.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      void pendingWriteCount().then((n) => {
        if (!cancelled) setPending(n);
      });
      return () => {
        cancelled = true;
      };
    }, []),
  );

  useFocusEffect(
    useCallback(() => {
      if (!dogId) return;
      let cancelled = false;
      (async () => {
        try {
          const [s, c] = await Promise.all([
            seizureRepo.listSeizures(dogId),
            checkinRepo.listCheckins(dogId),
          ]);
          if (!cancelled) setCounts({ seizures: s.length, checkins: c.length });
        } catch (e) {
          console.error('[more] counts failed', e);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [dogId]),
  );

  if (!dog) return null;

  const hasVetNumber =
    dog.emergencyVet.phone.trim().length > 0 || dog.vet.phone.trim().length > 0;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: contentClearance },
      ]}
    >
      <Title>Settings</Title>

      {/* --- Dog ---------------------------------------------------- */}
      <SectionTitle>Dog</SectionTitle>
      <Card style={styles.flush}>
        {/* The profile entry point also lives here, so it is reachable from
            the settings hub and not only from Home. */}
        <Pressable
          onPress={() => router.push('/dog-profile')}
          accessibilityRole="button"
          accessibilityLabel={`${dog.name}'s profile`}
          accessibilityHint="Opens the dog profile, where you can add a photo and details"
          style={({ pressed }) => [styles.dogHeader, pressed && styles.pressed]}
        >
          <DogAvatar photoUri={dog.photoUri} size={44} />
          <View style={styles.flexOne}>
            <Heading>{dog.name}</Heading>
            <Muted>{breedDisplay(dog)}</Muted>
          </View>
          {counts && (
            <View style={styles.countCol}>
              <Text style={styles.countValue}>{counts.seizures}</Text>
              <Text style={styles.countLabel}>seizures</Text>
            </View>
          )}
          <Icon name="chevron" size="md" color={colors.inkSoft} />
        </Pressable>
        <NavRow
          icon="profile"
          label="Choose breed"
          detail={dog.breed.breedName || 'Not set'}
          onPress={() => router.push('/breed-picker')}
        />
        <NavRow
          icon="records"
          label="Detail report"
          detail="Profile, seizures, medication history"
          onPress={() => router.push('/report')}
        />
        <NavRow
          icon="emergency"
          label="Emergency plan"
          detail={
            hasVetNumber
              ? 'Vet numbers saved'
              : 'No vet number yet — the call buttons need one'
          }
          onPress={() => router.push('/emergency-plan')}
          last
        />
      </Card>

      {/* --- Account and sync --------------------------------------- */}
      {/*
        Placed after the dog's own settings, not before them. An account is
        backup and a second device; it is not what this app is for, and putting
        it at the top would imply the records need one to be safe. They do not.
      */}
      <SectionTitle>Account</SectionTitle>
      <Card style={styles.flush}>
        <NavRow
          icon="records"
          label={accountLabel}
          detail={accountDetail}
          onPress={() => router.push('/account')}
          last
        />
      </Card>

      {/*
        Sign out lives here as well as on the Account screen, because it is the
        one thing people come to Settings looking for and expect to find
        without another tap.

        It is NOT one tap though. Signing out on an offline-first app can strip
        access to records this phone has not uploaded yet, so the confirm step
        exists to say how many — and to offer syncing them first, which is what
        the owner almost always actually wants.
      */}
      {authStatus === 'signed-in' && (
        <Card style={confirmSignOut ? styles.warnCard : undefined}>
          {confirmSignOut ? (
            <>
              <Heading>Sign out?</Heading>
              <Body style={styles.signOutBody}>
                {pending === 0
                  ? 'Everything is backed up. Your records stay on this phone and in your account.'
                  : `${pending === 1 ? '1 record has' : `${pending} records have`} not been backed up yet. They stay on this phone and will upload next time you sign in.`}
              </Body>
              {pending > 0 && (
                <Button
                  label="Sync now first"
                  onPress={() => void onSyncFirst()}
                  loading={signingOut}
                />
              )}
              <Button
                label="Sign out"
                variant="danger"
                onPress={() => void onSignOut()}
                disabled={signingOut}
              />
              <Button
                label="Cancel"
                variant="ghost"
                onPress={() => setConfirmSignOut(false)}
                disabled={signingOut}
              />
            </>
          ) : (
            <Button
              label="Sign out"
              variant="ghost"
              onPress={() => {
                void refreshPending();
                setConfirmSignOut(true);
              }}
            />
          )}
        </Card>
      )}

      {/* --- Dog switcher, only when it does something -------------- */}
      {dogs.length > 1 && (
        <>
          <SectionTitle>Switch dog</SectionTitle>
          <Card style={styles.flush}>
            {dogs.map((d, i) => (
              <Pressable
                key={d.id}
                onPress={() => void setActiveDog(d.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected: d.id === activeDogId }}
                accessibilityLabel={d.name}
                style={({ pressed }) => [
                  styles.dogRow,
                  i < dogs.length - 1 && styles.divider,
                  pressed && styles.pressed,
                ]}
              >
                <Body style={styles.dogRowLabel}>{d.name}</Body>
                {d.id === activeDogId && <Pill label="Active" tone="teal" />}
              </Pressable>
            ))}
          </Card>
        </>
      )}

      {/* --- Alert thresholds --------------------------------------- */}
      <SectionTitle>Seizure alerts</SectionTitle>
      <Card>
        <Muted style={styles.settingIntro}>
          These set when the live timer warns you. Change them only to match what
          your own veterinarian has told you.
        </Muted>

        <Stepper
          label="Warn after"
          value={settings.thresholdWarnMin}
          unit="min"
          min={1}
          max={settings.thresholdCritMin - 1}
          onChange={(thresholdWarnMin) => void updateSettings({ thresholdWarnMin })}
        />
        <Stepper
          label="Emergency after"
          value={settings.thresholdCritMin}
          unit="min"
          min={settings.thresholdWarnMin + 1}
          max={30}
          onChange={(thresholdCritMin) => void updateSettings({ thresholdCritMin })}
        />
        <Stepper
          label="Cluster window"
          value={settings.clusterWindowHrs}
          unit="hrs"
          min={1}
          max={24}
          onChange={(clusterWindowHrs) => void updateSettings({ clusterWindowHrs })}
        />

        <View style={[styles.settingRow, styles.dividerTop]}>
          <View style={styles.flexOne}>
            <Body style={styles.settingLabel}>Vibration alerts</Body>
            <Muted>Feel the threshold warnings without looking at the screen.</Muted>
          </View>
          <Switch
            value={settings.hapticsEnabled}
            onValueChange={(hapticsEnabled) => void updateSettings({ hapticsEnabled })}
            accessibilityLabel="Vibration alerts"
            trackColor={{ true: colors.teal, false: colors.line }}
          />
        </View>

        {(settings.thresholdWarnMin !== DEFAULT_SETTINGS.thresholdWarnMin ||
          settings.thresholdCritMin !== DEFAULT_SETTINGS.thresholdCritMin) && (
          <Pressable
            onPress={() =>
              Alert.alert(
                'Reset alert timings?',
                `Back to warning at ${DEFAULT_SETTINGS.thresholdWarnMin} minutes and emergency at ${DEFAULT_SETTINGS.thresholdCritMin}.`,
                [
                  { text: 'Keep mine', style: 'cancel' },
                  {
                    text: 'Reset',
                    onPress: () =>
                      void updateSettings({
                        thresholdWarnMin: DEFAULT_SETTINGS.thresholdWarnMin,
                        thresholdCritMin: DEFAULT_SETTINGS.thresholdCritMin,
                      }),
                  },
                ],
              )
            }
            accessibilityRole="button"
            style={styles.resetRow}
          >
            <Muted style={styles.resetLabel}>Reset to recommended timings</Muted>
          </Pressable>
        )}
      </Card>

      {/* --- Your data ----------------------------------------------
        This card used to say "there is no account and no server, so nothing is
        uploaded". That was true before sync existed and is now false in one
        direction and still true in another, which is exactly the kind of copy
        that has to be kept honest: an owner decides whether losing this phone
        matters based on what it says.
      */}
      <SectionTitle>Your data</SectionTitle>
      <Card>
        {authStatus === 'signed-in' ? (
          <Body>
            Your records are backed up to your account and appear on every
            device you sign in on. Seizure videos are the exception — those
            stay on the phone that filmed them and are never uploaded.
          </Body>
        ) : (
          <Body>
            Everything stays on this phone. Nothing is uploaded and nothing is
            shared unless you export it yourself.
          </Body>
        )}

        {counts && (
          <Muted style={{ marginTop: spacing.sm }}>
            {counts.seizures} seizure record{counts.seizures === 1 ? '' : 's'} ·{' '}
            {counts.checkins} check-in{counts.checkins === 1 ? '' : 's'}.
          </Muted>
        )}

        <Muted style={{ marginTop: spacing.sm }}>
          {authStatus === 'signed-in'
            ? pending === 0
              ? 'Everything here has been backed up. Losing this phone would still lose its seizure videos, because those never leave the device.'
              : `${pending === 1 ? '1 record has' : `${pending} records have`} not been backed up yet — they upload on the next sync.`
            : 'Without an account there is no backup, so losing this phone loses these records.'}
        </Muted>
      </Card>

      <Disclaimer>
        PawTrack helps you record and organise information for your dog&apos;s
        care. It does not diagnose or treat seizures. If your dog is having a
        prolonged or repeated seizure, follow your veterinarian&apos;s emergency
        plan and seek veterinary care.
      </Disclaimer>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */

/**
 * Plus/minus rather than a slider: these are small integers a vet may have
 * named exactly ("call us at five minutes"), and a slider makes hitting an
 * exact value fiddly with one hand.
 */
function Stepper({
  label,
  value,
  unit,
  min,
  max,
  onChange,
}: {
  label: string;
  value: number;
  unit: string;
  min: number;
  max: number;
  onChange: (next: number) => void;
}) {
  const canDec = value > min;
  const canInc = value < max;
  return (
    <View style={styles.settingRow}>
      <Body style={[styles.settingLabel, styles.flexOne]}>{label}</Body>
      <View style={styles.stepper}>
        <StepButton label="−" disabled={!canDec} onPress={() => onChange(value - 1)} hint={`Decrease ${label}`} />
        <Text style={styles.stepValue} accessibilityLabel={`${label} ${value} ${unit}`}>
          {value} {unit}
        </Text>
        <StepButton label="+" disabled={!canInc} onPress={() => onChange(value + 1)} hint={`Increase ${label}`} />
      </View>
    </View>
  );
}

function StepButton({
  label,
  disabled,
  onPress,
  hint,
}: {
  label: string;
  disabled: boolean;
  onPress: () => void;
  hint: string;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel={hint}
      accessibilityState={{ disabled }}
      style={({ pressed }) => [
        styles.stepBtn,
        pressed && styles.pressed,
        disabled && styles.stepBtnDisabled,
      ]}
    >
      <Text style={styles.stepBtnLabel}>{label}</Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  flexOne: { flex: 1 },
  flush: { padding: 0, overflow: 'hidden' },
  pressed: { opacity: 0.7 },
  divider: { borderBottomWidth: 1, borderBottomColor: colors.line },
  dividerTop: { borderTopWidth: 1, borderTopColor: colors.line, marginTop: spacing.sm, paddingTop: spacing.md },

  dogHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    padding: spacing.md,
    gap: spacing.md,
    borderBottomWidth: 1,
    borderBottomColor: colors.line,
  },
  countCol: { alignItems: 'flex-end' },
  countValue: {
    fontSize: fontSize.xl,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
    fontFamily: fontFamily.bold
  },
  countLabel: { fontSize: fontSize.xs, color: colors.inkSoft, fontFamily: fontFamily.regular },

  dogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
  },
  dogRowLabel: { fontWeight: '600', fontFamily: fontFamily.semibold },

  settingIntro: { marginBottom: spacing.sm },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  settingLabel: { fontWeight: '600', fontFamily: fontFamily.semibold },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: {
    width: 36,
    height: 36,
    // A CIRCLE: half of 36. Not a step on the radius scale — snapping
    // this to a token turns the circle into a rounded square.
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  stepBtnDisabled: { opacity: 0.35 },
  stepBtnLabel: { fontSize: 18, fontWeight: '700', color: colors.ink, lineHeight: 22, fontFamily: fontFamily.bold },
  stepValue: {
    minWidth: 58,
    textAlign: 'center',
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
    fontFamily: fontFamily.bold
  },

  resetRow: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.sm,
    borderRadius: radius.card,
  },
  /** Amber, not red: signing out is reversible and loses nothing. */
  warnCard: { backgroundColor: colors.amberTint, gap: spacing.sm },
  signOutBody: { lineHeight: 21 },
  resetLabel: { color: colors.tealDeep, fontWeight: '700', fontFamily: fontFamily.bold },
});
