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
  Body, Card, Disclaimer, Heading, Muted, NavRow, Pill, SectionTitle, Title,
} from '@/components/ui';
import { colors, fontSize, radius, spacing, MIN_TOUCH_TARGET } from '@/theme/tokens';
import { useChromeMetrics } from '@/theme/chrome';
import { useActiveDog, useAppStore } from '@/store/appStore';
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

  const dogId = dog?.id;

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

      {/* --- Your data ---------------------------------------------- */}
      <SectionTitle>Your data</SectionTitle>
      <Card>
        <Body>
          Everything stays on this phone. There is no account and no server, so
          nothing is uploaded and nothing is shared unless you export it yourself.
        </Body>
        {counts && (
          <Muted style={{ marginTop: spacing.sm }}>
            {counts.seizures} seizure record{counts.seizures === 1 ? '' : 's'} ·{' '}
            {counts.checkins} check-in{counts.checkins === 1 ? '' : 's'}.
          </Muted>
        )}
        <Muted style={{ marginTop: spacing.sm }}>
          Because there is no cloud backup yet, losing this phone loses these
          records. A vet report export is the next thing being built.
        </Muted>
      </Card>

      <Disclaimer>
        Paws Journal helps you record and organise information for your dog&apos;s
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
  },
  countLabel: { fontSize: fontSize.xs, color: colors.inkSoft },

  dogRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    minHeight: MIN_TOUCH_TARGET,
    paddingHorizontal: spacing.md,
  },
  dogRowLabel: { fontWeight: '600' },

  settingIntro: { marginBottom: spacing.sm },
  settingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
  },
  settingLabel: { fontWeight: '600' },

  stepper: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  stepBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
    borderWidth: 1,
    borderColor: colors.line,
  },
  stepBtnDisabled: { opacity: 0.35 },
  stepBtnLabel: { fontSize: 18, fontWeight: '700', color: colors.ink, lineHeight: 22 },
  stepValue: {
    minWidth: 58,
    textAlign: 'center',
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
    fontVariant: ['tabular-nums'],
  },

  resetRow: {
    minHeight: 44,
    justifyContent: 'center',
    marginTop: spacing.sm,
    borderRadius: radius.sm,
  },
  resetLabel: { color: colors.tealDeep, fontWeight: '700' },
});
