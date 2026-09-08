/**
 * The agreement gate. Shown once, straight after the account is created.
 *
 * ── ONE PAGE, NOT THREE ───────────────────────────────────────────────
 *
 * This used to be a summary screen with the two documents behind separate
 * navigations. That is a worse shape for the thing being asked: the owner is
 * being asked to agree to text they have to leave the screen to read, come
 * back from, and then agree to from memory. Two of the three screens existed
 * only to hold text.
 *
 * So it is one page now. The documents are switched in place with the app's
 * own SegmentedControl — the same control History uses to swap one list for
 * another — and the agreement bar is PINNED below them rather than living at
 * the end of a long scroll. Whatever the owner is reading, the thing they are
 * being asked to do is on screen next to it.
 *
 * ── WHY THE THREE POINTS STAY AT THE TOP ──────────────────────────────
 *
 * Nobody reads a legal document on a phone, and pretending otherwise is how
 * apps end up with owners who have agreed to something they could not
 * describe. The three cards say the things that would actually change what
 * someone DOES — this is not a vet, videos exist in one place only, nothing is
 * sold — in language they will read, above the text that says the same things
 * properly. Someone who taps Agree without scrolling still leaves knowing them.
 *
 * ── WHY THERE IS NO WAY PAST IT ───────────────────────────────────────
 *
 * No "not now", no skip, no back gesture. There is nothing to decline INTO:
 * the account exists by this point, and the agreement is recorded against it
 * (services/consent.ts), so an owner who does not accept has no state the app
 * can put them in. The honest options are agree or close the app, and the
 * screen says exactly that instead of offering a "later" that leads nowhere.
 */

import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, Heading, Muted, SegmentedControl, Title } from '@/components/ui';
import { Icon } from '@/components/Icon';
import { LegalDocumentBody } from '@/components/LegalDocument';
import { LEGAL_EMAIL, PRIVACY, TERMS } from '@/constants/legal';
import { useAuthStore } from '@/store/authStore';
import { useConsentStore } from '@/store/consentStore';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';

type DocId = 'terms' | 'privacy';

export default function ConsentScreen() {
  const insets = useSafeAreaInsets();

  const userId = useAuthStore((s) => s.user?.id ?? null);
  const isUpdate = useConsentStore((s) => s.isUpdate);
  const accept = useConsentStore((s) => s.accept);

  const [tab, setTab] = useState<DocId>('terms');
  const [agreed, setAgreed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const doc = tab === 'terms' ? TERMS : PRIVACY;

  const onAgree = async () => {
    // Without a session there is nothing to record the agreement against. The
    // route gate makes this unreachable, so it is a guard rather than a state
    // the owner can actually get into.
    if (!agreed || busy || !userId) return;
    setBusy(true);
    setError(null);
    try {
      await accept(userId);
      /*
       * Sent to the tabs, not to onboarding, even for a brand-new owner.
       *
       * The route gate re-runs the moment the store flips and is the thing
       * that knows what comes next — no dog yet means onboarding. Duplicating
       * that decision here would give the app two places deciding where a new
       * owner lands, and they would disagree the first time either changed.
       */
      router.replace('/(tabs)');
    } catch (e) {
      console.warn('[consent] could not record agreement', e);
      setError('Could not save your agreement. Please try again.');
      setBusy(false);
    }
  };

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[colors.tealTint, colors.bg]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <ScrollView
        contentContainerStyle={[
          styles.content,
          { paddingTop: insets.top + spacing.lg },
        ]}
        showsVerticalScrollIndicator={false}
      >
        {/* ---- Header --------------------------------------------- */}
        <View style={styles.header}>
          <View style={styles.mark}>
            <Icon name="profile" size="xl" color={colors.tealDeep} filled />
          </View>
          <Title>{isUpdate ? 'We’ve updated our terms' : 'One last thing'}</Title>
          <Muted style={styles.lede}>
            {isUpdate
              ? 'We’ve changed our Terms of Service and Privacy Policy. Please review and accept them to carry on — nothing you’ve recorded has changed.'
              : 'Your account is ready. Here’s how PawTrack works and what we do with your dog’s records.'}
          </Muted>
        </View>

        {/* ---- The three things that change what you'd do ---------- */}
        <Card style={styles.points}>
          <Point
            icon="emergency"
            title="Not a substitute for your vet"
            body="PawTrack records what happened — it doesn’t diagnose seizures or decide what’s an emergency. If your dog needs help, contact your vet straight away."
          />
          <View style={styles.rule} />
          <Point
            icon="device"
            title="Seizure videos never leave this phone"
            body="Your records back up to your account, but videos stay on the device that filmed them. They’re never uploaded — so export anything you can’t afford to lose."
          />
          <View style={styles.rule} />
          <Point
            icon="lock"
            title="We don’t sell your data, ever"
            body="No advertising, no selling, no location tracking. You choose who you share records with."
          />
        </Card>

        {/* ---- The documents themselves, in place ------------------ */}
        <View style={styles.docsHeader}>
          <Heading>The full terms</Heading>
          <Muted style={styles.docsNote}>
            Both apply. You can read them again any time from Settings.
          </Muted>
        </View>

        <SegmentedControl<DocId>
          options={[
            { value: 'terms', label: 'Terms of Service' },
            { value: 'privacy', label: 'Privacy Policy' },
          ]}
          value={tab}
          onChange={setTab}
          accessibilityLabel="Choose which document to read"
        />

        <Muted style={styles.updated}>Last updated {doc.updated}</Muted>

        <LegalDocumentBody doc={doc} />
      </ScrollView>

      {/*
        ---- The agreement bar ------------------------------------------
        Pinned, not appended. The documents run to thousands of words; an Agree
        button at the end of them would be reachable only by scrolling past
        text most people will not read, which turns a legal requirement into a
        scrolling exercise. Keeping it in view is also what lets the checkbox
        sit next to the thing it refers to.
      */}
      <View style={[styles.bar, { paddingBottom: insets.bottom + spacing.md }]}>
        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Pressable
          onPress={() => setAgreed((v) => !v)}
          accessibilityRole="checkbox"
          accessibilityState={{ checked: agreed }}
          accessibilityLabel="I am 18 or older and I agree to the Terms of Service and Privacy Policy"
          hitSlop={8}
          style={({ pressed }) => [
            styles.agreeRow,
            agreed && styles.agreeRowOn,
            pressed && styles.pressed,
          ]}
        >
          <View style={[styles.box, agreed && styles.boxOn]}>
            {agreed && <Icon name="check" size="sm" color={colors.onMedia} filled />}
          </View>
          <Text style={styles.agreeText}>
            I’m 18 or older, and I agree to the{' '}
            <Text style={styles.agreeStrong}>Terms of Service</Text> and{' '}
            <Text style={styles.agreeStrong}>Privacy Policy</Text>.
          </Text>
        </Pressable>

        <Button
          label={isUpdate ? 'Accept and continue' : 'Agree and continue'}
          onPress={() => void onAgree()}
          disabled={!agreed}
          loading={busy}
          large
          accessibilityHint="Records your agreement and opens the app"
        />

        <Muted style={styles.footer}>
          You need to accept these to use PawTrack. Questions? {LEGAL_EMAIL}
        </Muted>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */

function Point({
  icon,
  title,
  body,
}: {
  icon: 'emergency' | 'device' | 'lock';
  title: string;
  body: string;
}) {
  return (
    <View style={styles.point} accessible accessibilityLabel={`${title}. ${body}`}>
      <View style={styles.pointGlyph}>
        <Icon name={icon} size="md" color={colors.tealDeep} />
      </View>
      <View style={styles.flexOne}>
        <Heading>{title}</Heading>
        <Body style={styles.pointBody}>{body}</Body>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: {
    paddingHorizontal: spacing.lg,
    gap: spacing.md,
    // Clears the pinned bar. Without it the last section of the document sits
    // permanently behind the thing asking you to agree to it.
    paddingBottom: spacing.xl * 7,
  },

  header: { gap: spacing.sm, alignItems: 'flex-start' },
  mark: {
    width: 56,
    height: 56,
    // A CIRCLE: half of 56, not a radius token.
    borderRadius: 28,
    backgroundColor: colors.card,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: spacing.xs,
  },
  lede: { lineHeight: 21 },

  points: { gap: spacing.md },
  point: { flexDirection: 'row', gap: spacing.md, alignItems: 'flex-start' },
  pointGlyph: {
    width: 34,
    height: 34,
    // A CIRCLE: half of 34.
    borderRadius: 17,
    backgroundColor: colors.tealTint,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 0,
  },
  pointBody: { lineHeight: 21, marginTop: 2 },
  rule: { height: 1, backgroundColor: colors.line },

  docsHeader: { gap: 2, marginTop: spacing.sm },
  docsNote: { lineHeight: 19 },
  updated: { marginTop: -spacing.xs },

  bar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
    gap: spacing.sm,
    backgroundColor: colors.card,
    borderTopWidth: 1,
    borderTopColor: colors.line,
    borderTopLeftRadius: radius.sheet,
    borderTopRightRadius: radius.sheet,
    // Reads as a layer above the document rather than the end of it.
    shadowColor: '#20293A',
    shadowOpacity: 0.1,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: -4 },
    elevation: 12,
  },

  agreeRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: spacing.md,
    padding: spacing.md,
    borderRadius: radius.field,
    borderWidth: 1,
    borderColor: colors.line,
    backgroundColor: colors.bg,
  },
  // Ticking tints the whole row, not just the box: at arm's length the box
  // alone is too small to read as a state change.
  agreeRowOn: { borderColor: colors.teal, backgroundColor: colors.tealTint },
  box: {
    width: 24,
    height: 24,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: colors.inkSoft,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 0,
    marginTop: 1,
  },
  boxOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  agreeText: {
    flex: 1,
    fontSize: fontSize.base,
    lineHeight: 21,
    color: colors.ink,
    fontFamily: fontFamily.regular,
  },
  agreeStrong: { fontFamily: fontFamily.bold, fontWeight: '700' },

  error: {
    fontSize: fontSize.sm,
    lineHeight: 18,
    color: colors.redDeep,
    fontFamily: fontFamily.semibold,
  },
  footer: { fontSize: fontSize.xs, lineHeight: 16 },
  pressed: { opacity: 0.7 },
  flexOne: { flex: 1 },
});
