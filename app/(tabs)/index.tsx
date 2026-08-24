/**
 * Home / dashboard.
 *
 * The single most important thing on this screen is the Record Seizure button.
 * It is first in the layout, largest, and starts the timer on a single tap
 * with no confirmation dialog — a confirmation step would cost seconds during
 * an emergency and add nothing.
 */

import { useCallback, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import * as Haptics from 'expo-haptics';

import {
  Body, Card, Disclaimer, Heading, Muted, Pill, SectionTitle, StatTile, Title,
} from '@/components/ui';
import { colors, fontSize, radius, shadow, spacing } from '@/theme/tokens';
import { useActiveDog, useAppStore } from '@/store/appStore';
import { useActiveSeizure } from '@/store/activeSeizureStore';
import { breedDisplay } from '@/db/dogRepo';
import * as seizureRepo from '@/db/seizureRepo';
import * as checkinRepo from '@/db/checkinRepo';
import { formatDuration } from '@/utils/time';
import type { Seizure } from '@/types/domain';

const DAY_MS = 86_400_000;

export default function HomeScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dog = useActiveDog();
  const settings = useAppStore((s) => s.settings);
  const startSeizure = useActiveSeizure((s) => s.start);

  const [seizures, setSeizures] = useState<Seizure[]>([]);
  const [hasCheckin, setHasCheckin] = useState(false);
  const [loading, setLoading] = useState(true);

  // useFocusEffect (not useEffect) so the dashboard refreshes every time the
  // user returns to it — e.g. straight after saving a seizure.
  useFocusEffect(
    useCallback(() => {
      let cancelled = false;
      if (!dog) return;
      (async () => {
        try {
          const [list, checkin] = await Promise.all([
            seizureRepo.listSeizuresSince(dog.id, Date.now() - 400 * DAY_MS),
            checkinRepo.getTodaysCheckin(dog.id),
          ]);
          if (!cancelled) {
            setSeizures(list);
            setHasCheckin(Boolean(checkin));
          }
        } catch (e) {
          console.error('[home] load failed', e);
        } finally {
          if (!cancelled) setLoading(false);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [dog]),
  );

  if (!dog) return null;

  const now = Date.now();
  const last = seizures[0];
  const week = seizures.filter((s) => now - s.start < 7 * DAY_MS);
  const month = seizures.filter((s) => now - s.start < 30 * DAY_MS);
  const avgDuration =
    month.length > 0
      ? Math.round(month.reduce((sum, s) => sum + s.durationSec, 0) / month.length)
      : null;
  const daysSince = last ? Math.floor((now - last.start) / DAY_MS) : null;

  const onRecord = () => {
    if (settings.hapticsEnabled) {
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy);
    }
    startSeizure(dog.id);
    router.push('/seizure/live');
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Muted style={styles.eyebrow}>PAWS JOURNAL</Muted>
      <Title>Today</Title>

      {/* --- Primary action ------------------------------------------- */}
      <Pressable
        onPress={onRecord}
        accessibilityRole="button"
        accessibilityLabel="Record seizure"
        accessibilityHint="Starts the seizure timer immediately"
        style={({ pressed }) => [styles.record, pressed && { opacity: 0.9 }]}
      >
        <View style={styles.recordTextWrap}>
          <Body style={styles.recordLabel}>Record seizure</Body>
          <Body style={styles.recordSub}>
            Start the timer the moment it begins
          </Body>
        </View>
        <View style={styles.recordDot} />
      </Pressable>

      {/* --- Dog profile + breed -------------------------------------- */}
      <SectionTitle>Dog profile</SectionTitle>
      <Card>
        <View style={styles.row}>
          <View style={styles.flex}>
            <Heading>{dog.name}</Heading>
            <Muted>{breedDisplay(dog)}</Muted>
          </View>
          <Pressable
            onPress={() => router.push('/breed-picker')}
            accessibilityRole="button"
            accessibilityLabel="Choose breed"
            style={styles.smallBtn}
          >
            <Body style={styles.smallBtnLabel}>Choose Breed</Body>
          </Pressable>
        </View>
      </Card>

      {/* --- Stats ---------------------------------------------------- */}
      <View style={styles.statGrid}>
        <StatTile
          value={daysSince === null ? '—' : String(daysSince)}
          label="Days since last seizure"
        />
        <StatTile value={String(week.length)} label="Seizures this week" />
        <StatTile value={String(month.length)} label="Seizures this month" />
        <StatTile
          value={avgDuration === null ? '—' : formatDuration(avgDuration)}
          label="Avg. duration (30d)"
        />
      </View>

      {/* --- Last seizure --------------------------------------------- */}
      <SectionTitle>Last seizure</SectionTitle>
      {last ? (
        <Pressable onPress={() => router.push(`/seizure-detail/${last.id}`)}>
          <Card>
            <View style={styles.row}>
              <Body style={styles.semibold}>
                {new Date(last.start).toLocaleDateString(undefined, {
                  month: 'short',
                  day: 'numeric',
                })}
                {', '}
                {new Date(last.start).toLocaleTimeString(undefined, {
                  hour: 'numeric',
                  minute: '2-digit',
                })}
              </Body>
              <Pill label={formatDuration(last.durationSec)} tone="teal" />
            </View>
            <Muted style={{ marginTop: 6 }} numberOfLines={2}>
              {last.ictalObs.slice(0, 3).join(', ') || 'No observations logged'}
            </Muted>
          </Card>
        </Pressable>
      ) : (
        <Card>
          <Muted>
            {loading
              ? 'Loading…'
              : 'No seizures recorded yet. When one happens, tap Record seizure right away.'}
          </Muted>
        </Card>
      )}

      {/* --- Daily check-in ------------------------------------------- */}
      <SectionTitle>Today</SectionTitle>
      <Card>
        <View style={styles.row}>
          <Heading>Daily check-in</Heading>
          <Pill
            label={hasCheckin ? 'Done' : 'Not yet'}
            tone={hasCheckin ? 'green' : 'amber'}
          />
        </View>
        <Muted style={{ marginVertical: 8 }}>
          30 seconds — recording normal days too is what makes the pattern
          analysis meaningful.
        </Muted>
        <Pressable
          onPress={() => router.push('/daily-checkin')}
          accessibilityRole="button"
          style={styles.primaryBtn}
        >
          <Body style={styles.primaryBtnLabel}>
            {hasCheckin ? "Update today's check-in" : 'Do check-in'}
          </Body>
        </Pressable>
      </Card>

      <Disclaimer>
        Patterns shown in this app describe associations observed in your own
        records. They do not diagnose a cause and are not a substitute for
        veterinary care.
      </Disclaimer>

      <View style={{ height: spacing.xl }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  eyebrow: { letterSpacing: 1.4, fontWeight: '700', fontSize: fontSize.xs },
  flex: { flex: 1 },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  semibold: { fontWeight: '600' },

  record: {
    marginTop: spacing.md,
    marginBottom: spacing.md,
    backgroundColor: colors.red,
    borderRadius: radius.lg,
    padding: spacing.lg,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    ...shadow.raised,
  },
  recordTextWrap: { flex: 1 },
  recordLabel: { color: '#fff', fontSize: 22, fontWeight: '700' },
  recordSub: { color: '#fff', opacity: 0.85, fontSize: fontSize.sm, marginTop: 3 },
  recordDot: {
    width: 14, height: 14, borderRadius: 7, backgroundColor: '#fff',
  },

  statGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },

  smallBtn: {
    minHeight: 44,
    justifyContent: 'center',
    paddingHorizontal: spacing.md,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.line,
  },
  smallBtnLabel: { fontWeight: '700', fontSize: fontSize.sm },

  primaryBtn: {
    minHeight: 48,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.teal,
    borderRadius: radius.pill,
  },
  primaryBtnLabel: { color: '#fff', fontWeight: '700' },
});
