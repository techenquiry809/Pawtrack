/**
 * Create an account.
 *
 * ── HOW MUCH THIS ASKS FOR, AND WHY NOT MORE ──────────────────────────
 *
 * Name, email and password are required. Phone and emergency contact are
 * optional and labelled as such.
 *
 * This app already holds a dog's seizure history, which is sensitive on its
 * own and becomes far more so once it is attached to a named, reachable
 * person. Every additional field is one more thing to lose in a breach and one
 * more thing to hand over under a data request, so the bar for adding one is
 * that the app would be worse without it.
 *
 * The emergency contact clears that bar: this is a seizure app, and "who else
 * can help with this dog" is genuinely useful on a bad night. A postal
 * address, a date of birth or a job title would not, which is why they are not
 * here.
 *
 * ── WHERE THE DETAILS ACTUALLY GO ─────────────────────────────────────
 *
 * Into `public.profiles`, under RLS — not into user_metadata, which is
 * user-editable and therefore unsafe for anything a decision reads. When the
 * project requires email confirmation there is no session yet and no row can
 * be written, so the values ride along in `options.data` and are reconciled on
 * first sign-in. See authStore.
 */

import { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { router } from 'expo-router';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Heading, Muted, Title } from '@/components/ui';
import { AuthField } from '@/components/AuthField';
import { TextAction } from '@/components/form';
import { BackButton } from '@/components/BackButton';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';
import { MIN_PASSWORD_LENGTH, useAuthStore } from '@/store/authStore';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

type Errors = Partial<
  Record<'fullName' | 'email' | 'password' | 'confirm', string>
>;

export default function SignUpScreen() {
  const insets = useSafeAreaInsets();

  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const awaitingConfirmation = useAuthStore((s) => s.awaitingConfirmation);
  const signUpWithPassword = useAuthStore((s) => s.signUpWithPassword);
  const setError = useAuthStore((s) => s.setError);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});

  const clear = (key: keyof Errors) =>
    setErrors((e) => ({ ...e, [key]: undefined }));

  const validate = (): boolean => {
    const next: Errors = {};

    if (fullName.trim().length < 2) next.fullName = 'Enter your name.';
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';

    // Length is the only property that reliably matters, so this asks for
    // length rather than for a symbol and a digit — composition rules mostly
    // produce `Password1!` and a note on the fridge.
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (confirm !== password) next.confirm = 'The two passwords do not match.';

    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const onSubmit = async () => {
    setError(null);
    if (!validate()) return;
    await signUpWithPassword({
      fullName,
      email,
      password,
      phone,
      emergencyContactName: contactName,
      emergencyContactPhone: contactPhone,
    });
  };

  /* ---- Confirmation state -------------------------------------------
   * A terminal state, not a step. Nothing else can happen until the link is
   * clicked, so the form is replaced rather than left behind it — leaving a
   * live "Create account" button under this message invites a second attempt
   * that fails with "User already registered". */
  if (awaitingConfirmation) {
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
            { paddingTop: insets.top + spacing.xl },
          ]}
        >
          <View style={styles.card}>
            <Heading>Confirm your email</Heading>
            <Body style={styles.cardBody}>
              We&rsquo;ve sent a link to{' '}
              <Text style={styles.strong}>{awaitingConfirmation}</Text>. Open it
              on this phone, then sign in.
            </Body>
            <Muted style={styles.cardBody}>
              Nothing you record before then is lost — your records are saved on
              this phone and are added to your account when you sign in.
            </Muted>
            <Button
              label="Back to sign in"
              onPress={() => router.replace('/sign-in')}
            />
          </View>
        </ScrollView>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[colors.tealTint, colors.bg]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: insets.top + spacing.md,
              paddingBottom: insets.bottom + spacing.xl,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <BackButton />

          <View style={styles.header}>
            <Title>Create your account</Title>
            <Muted style={styles.lede}>
              This backs up your dog&rsquo;s records and lets you open them on
              another device.
            </Muted>
          </View>

          {/* ---- Required ------------------------------------------- */}
          <View style={styles.card}>
            <AuthField
              label="Full name"
              value={fullName}
              onChangeText={(v) => {
                setFullName(v);
                clear('fullName');
              }}
              placeholder="Sam Karki"
              autoCapitalize="words"
              autoComplete="name"
              textContentType="name"
              error={errors.fullName}
              editable={!busy}
            />

            <AuthField
              label="Email"
              value={email}
              onChangeText={(v) => {
                setEmail(v);
                clear('email');
              }}
              placeholder="you@example.com"
              keyboardType="email-address"
              autoComplete="email"
              textContentType="emailAddress"
              error={errors.email}
              editable={!busy}
            />

            <AuthField
              label="Password"
              value={password}
              onChangeText={(v) => {
                setPassword(v);
                clear('password');
              }}
              placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
              secure
              // `newPassword` is what makes iOS offer "Use Strong Password".
              // With `password` here the generator never appears and people
              // type something they can remember, which means reuse.
              autoComplete="new-password"
              textContentType="newPassword"
              error={errors.password}
              editable={!busy}
            />

            <AuthField
              label="Confirm password"
              value={confirm}
              onChangeText={(v) => {
                setConfirm(v);
                clear('confirm');
              }}
              placeholder="Type it again"
              secure
              autoComplete="new-password"
              textContentType="newPassword"
              error={errors.confirm}
              editable={!busy}
            />
          </View>

          {/* ---- Optional -------------------------------------------- */}
          <View style={styles.card}>
            <View>
              <Heading>Contact details</Heading>
              <Muted style={styles.optionalNote}>
                All optional. You can add or change these later.
              </Muted>
            </View>

            <AuthField
              label="Phone"
              hint="optional"
              value={phone}
              onChangeText={setPhone}
              placeholder="+977 98…"
              keyboardType="phone-pad"
              autoComplete="tel"
              textContentType="telephoneNumber"
              editable={!busy}
            />

            <AuthField
              label="Emergency contact"
              hint="optional"
              value={contactName}
              onChangeText={setContactName}
              placeholder="Who else can help with your dog"
              autoCapitalize="words"
              autoComplete="off"
              textContentType="none"
              editable={!busy}
            />

            <AuthField
              label="Their phone"
              hint="optional"
              value={contactPhone}
              onChangeText={setContactPhone}
              placeholder="+977 98…"
              keyboardType="phone-pad"
              autoComplete="off"
              textContentType="none"
              editable={!busy}
            />
          </View>

          {error && (
            <View style={[styles.card, styles.errorCard]}>
              <Body>{error}</Body>
            </View>
          )}

          <Button
            label="Create account"
            large
            loading={busy}
            onPress={() => void onSubmit()}
          />

          <View style={styles.footer}>
            <Muted>Already have an account?</Muted>
            <Pressable
              onPress={() => router.replace('/sign-in')}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Sign in instead"
            >
              <Text style={styles.link}>Sign in</Text>
            </Pressable>
          </View>

          <Muted style={styles.privacy}>
            Your dog&rsquo;s records are only ever visible to you. Seizure
            videos never leave this phone.
          </Muted>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },

  header: { gap: spacing.xs, marginBottom: spacing.xs },
  lede: { lineHeight: 21 },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#20293A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  errorCard: { backgroundColor: colors.redTint, gap: spacing.sm },
  cardBody: { lineHeight: 21 },
  optionalNote: { marginTop: 2 },
  strong: { fontWeight: '700', color: colors.ink, fontFamily: fontFamily.bold },

  footer: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  link: { fontSize: fontSize.md, fontWeight: '800', color: colors.tealDeep, fontFamily: fontFamily.extrabold },

  privacy: {
    textAlign: 'center',
    fontSize: fontSize.xs,
    lineHeight: 17,
    fontFamily: fontFamily.regular
  },
});
