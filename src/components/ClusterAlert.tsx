/**
 * "More than one seizure in the last N hours."
 *
 * ── WHAT THIS IS ALLOWED TO SAY ───────────────────────────────────────
 *
 * A count, a window, and a prompt to look at the plan the owner's own
 * veterinarian gave them. Nothing else.
 *
 * Two or more seizures in twenty-four hours is a widely used threshold for
 * phoning a vet, and it is why this exists — but the app must not be the thing
 * that says so. It reports what is in the record ("2 seizures recorded since
 * yesterday"), notes that many vets treat this as a reason to call, and hands
 * over to the emergency plan the owner entered themselves. The threshold is a
 * SETTING, because practices differ and so do dogs.
 *
 * See docs/ARCHITECTURE.md → the one rule that outranks everything.
 *
 * ── WHY THE POPUP FIRES ONCE PER CLUSTER ──────────────────────────────
 *
 * A modal that reappeared on every launch would be dismissed reflexively
 * within a week, and then it is noise on the night it matters. So it is keyed
 * to the cluster's own start time: a NEW run raises it once, and re-opening
 * the app does not. The banner stays visible underneath for as long as the
 * window is open, which is the part that is meant to persist.
 */

import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Linking,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';

import { Body, Button, Heading, Muted } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';
import type { SeizureCluster } from '@/features/analytics';
import type { Dog } from '@/types/domain';
import { getSyncValue, setSyncValue } from '@/db/syncState';

/** Which cluster the owner has already been shown the modal for. */
const ACK_KEY = 'cluster_acknowledged_at';

function hoursAgo(from: number, now: number): string {
  const hours = Math.max(0, Math.round((now - from) / 3_600_000));
  if (hours <= 1) return 'in the last hour';
  if (hours < 24) return `in the last ${hours} hours`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'since yesterday' : `in the last ${days} days`;
}

export function ClusterAlert({
  cluster,
  dog,
  windowHours,
  now,
}: {
  cluster: SeizureCluster;
  dog: Dog;
  windowHours: number;
  now: number;
}) {
  const router = useRouter();
  const [modalOpen, setModalOpen] = useState(false);

  /**
   * Whether the screen hosting this alert is the one on top.
   *
   * ── WHY A MODAL NEEDS THIS AT ALL ─────────────────────────────────────
   *
   * React Native's Modal renders above the entire app, not above its own
   * screen. The tab this lives on stays MOUNTED when the owner pushes another
   * route, so without this guard the popup can appear over whatever they
   * navigated to — including, in the worst case, the live seizure timer.
   *
   * Caught on the simulator: deep-linking to a video screen while a cluster
   * was unacknowledged put the modal straight over it.
   *
   * Gating on focus rather than unmounting means the alert is still waiting
   * when they come back, which is the behaviour that was wanted.
   */
  const [focused, setFocused] = useState(true);
  useFocusEffect(
    useCallback(() => {
      setFocused(true);
      return () => setFocused(false);
    }, []),
  );

  // Raise the modal only for a cluster this device has not shown yet.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const acked = await getSyncValue(ACK_KEY);
      if (cancelled) return;
      if (acked !== String(cluster.startedAt)) setModalOpen(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [cluster.startedAt]);

  const acknowledge = useCallback(() => {
    setModalOpen(false);
    void setSyncValue(ACK_KEY, String(cluster.startedAt));
  }, [cluster.startedAt]);

  const phone = dog.emergencyVet.phone.trim() || dog.vet.phone.trim();

  const callVet = useCallback(async () => {
    acknowledge();
    if (!phone) {
      Alert.alert(
        'No veterinary number saved',
        "Add your veterinarian's number in the Emergency Plan so this button can call them.",
        [
          { text: 'Not now', style: 'cancel' },
          { text: 'Add number', onPress: () => router.push('/emergency-plan') },
        ],
      );
      return;
    }
    // Not gated on canOpenURL: on Android 11+ that returns false for `tel:`
    // without a <queries> intent, which would make this silently refuse to
    // dial. Same reasoning as the live seizure screen.
    try {
      await Linking.openURL(`tel:${phone}`);
    } catch {
      Alert.alert('Could not start the call', `Dial ${phone} from your phone app.`);
    }
  }, [acknowledge, phone, router]);

  const count = cluster.count;
  const when = hoursAgo(cluster.startedAt, now);

  return (
    <>
      {/* ---- Persistent banner ---------------------------------- */}
      <Pressable
        onPress={() => setModalOpen(true)}
        accessibilityRole="button"
        accessibilityLabel={`Attention. ${count} seizures recorded ${when}. Open details.`}
        style={({ pressed }) => [styles.banner, pressed && styles.pressed]}
      >
        <View style={styles.bannerIcon}>
          <Icon name="emergency" size="md" color={colors.redDeep} filled />
        </View>
        <View style={styles.bannerText}>
          <Text style={styles.bannerTitle}>
            {count} seizures {when}
          </Text>
          <Text style={styles.bannerBody}>
            Many vets treat more than one in {windowHours} hours as a reason to
            call. Tap for your plan.
          </Text>
        </View>
        <Icon name="chevron" size="md" color={colors.redDeep} />
      </Pressable>

      {/* ---- Popup ---------------------------------------------- */}
      <Modal
        visible={modalOpen && focused}
        animationType="fade"
        transparent
        // Android back button must dismiss, or this becomes a trap.
        onRequestClose={acknowledge}
      >
        <View style={styles.scrim}>
          <View style={styles.sheet}>
            <View style={styles.sheetIcon}>
              <Icon name="emergency" size="lg" color={colors.redDeep} filled />
            </View>

            <Heading>
              {count} seizures recorded {when}
            </Heading>

            {/*
              Does NOT restate the count — the headline just gave it, and
              "3 seizures in the last 6 hours" followed by "3 seizures within
              24 hours" reads like two different findings. This sentence exists
              to say which RULE was tripped, since the window is a setting the
              owner chose and may have forgotten.
            */}
            <Body style={styles.sheetBody}>
              That is more than one inside the {windowHours}-hour window set in
              Settings.
            </Body>

            <Body style={styles.sheetBody}>
              Many veterinary practices treat more than one seizure in a day as
              a reason to be contacted, and some prescribe medication to be
              given at that point. Check the emergency plan you saved.
            </Body>

            {/*
              No dose, no drug name, no "you should". The plan screen shows
              only what the owner's own vet told them — see EmergencyPlanSchema.
            */}
            <Muted style={styles.sheetNote}>
              This is a count of your own records, not a diagnosis. Your
              veterinarian decides what it means for {dog.name}.
            </Muted>

            <View style={styles.actions}>
              <Button label="Call the vet" variant="danger" onPress={() => void callVet()} />
              <Button
                label="Open emergency plan"
                onPress={() => {
                  acknowledge();
                  router.push('/emergency-plan');
                }}
              />
              <Button label="Close" variant="ghost" onPress={acknowledge} />
            </View>
          </View>
        </View>
      </Modal>
    </>
  );
}

const styles = StyleSheet.create({
  banner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.redTint,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.red,
    padding: spacing.md,
  },
  pressed: { opacity: 0.9, transform: [{ scale: 0.99 }] },
  bannerIcon: {
    width: 36,
    height: 36,
    // A CIRCLE: half of 36. Not a step on the radius scale — snapping
    // this to a token turns the circle into a rounded square.
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
  },
  bannerText: { flex: 1, gap: 2 },
  bannerTitle: { fontSize: fontSize.base, fontWeight: '800', color: colors.redDeep, fontFamily: fontFamily.extrabold },
  bannerBody: { fontSize: fontSize.sm, color: colors.ink, lineHeight: 18, fontFamily: fontFamily.regular },

  scrim: {
    flex: 1,
    backgroundColor: 'rgba(32,41,58,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    backgroundColor: colors.card,
    borderRadius: radius.sheet,
    padding: spacing.lg,
    gap: spacing.sm,
  },
  sheetIcon: {
    width: 52,
    height: 52,
    // A CIRCLE: half of 52. Not a step on the radius scale — snapping
    // this to a token turns the circle into a rounded square.
    borderRadius: 26,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.redTint,
    marginBottom: spacing.xs,
  },
  sheetBody: { lineHeight: 21 },
  sheetNote: { lineHeight: 18, marginTop: spacing.xs },
  actions: { gap: spacing.sm, marginTop: spacing.md },
});
