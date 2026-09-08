import { useEffect, useState } from 'react';
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
import { PasswordStrength } from '@/components/PasswordStrength';
import { ErrorNotice } from '@/components/ErrorNotice';
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
  const existingAccountEmail = useAuthStore((s) => s.existingAccountEmail);
  const clearExistingAccount = useAuthStore((s) => s.clearExistingAccount);
  const setError = useAuthStore((s) => s.setError);

  const [fullName, setFullName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [contactName, setContactName] = useState('');
  const [contactPhone, setContactPhone] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<Errors>({});
  /*
   * The code box is not here any more — it is /verify, which serves this flow
   * and the password reset alike. Signup's job ends the moment the account is
   * created; asking for the code is a separate instruction and gets a separate
   * screen. `replace`, not `push`: this form has done its work and coming back
   * to it would only offer a second "Create account" for an address that now
   * has one, which fails with "User already registered".
   */
  useEffect(() => {
    if (!awaitingConfirmation) return;
    router.replace({ pathname: '/verify', params: { mode: 'signup' } });
  }, [awaitingConfirmation]);

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

  /* ---- Already registered -------------------------------------------
   * A TERMINAL state for this address, and deliberately NOT a code screen.
   *
   * Supabase answers an existing confirmed email with a success-shaped
   * response carrying no identities (see signUpWithPassword). Reading that as
   * success is what used to put "we've sent you a 6-digit code" in front of
   * someone whose address was never sent one — a screen with no way forward,
   * because the code cannot arrive.
   *
   * The form is replaced rather than left underneath: a live "Create account"
   * button here just invites the same dead end again. This one stays on this
   * screen rather than routing away, because unlike a pending confirmation
   * there is no next step to send anyone to — the answer is "you already have
   * one", and the two ways out are both right here.
   */
  if (existingAccountEmail) {
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
          keyboardShouldPersistTaps="handled"
        >
          <View style={styles.card}>
            <Heading>You already have an account</Heading>
            <Body style={styles.cardBody}>
              <Text style={styles.strong}>{existingAccountEmail}</Text> is
              already registered. Sign in with your password instead — your
              dog&rsquo;s records are waiting in that account.
            </Body>

            <Button
              label="Sign in instead"
              onPress={() => {
                clearExistingAccount();
                router.replace('/sign-in');
              }}
            />

            <Button
              label="Use a different email"
              variant="ghost"
              onPress={() => {
                clearExistingAccount();
                setEmail('');
              }}
            />

            <Muted style={styles.cardBody}>
              Forgotten the password? Choose &ldquo;Sign in instead&rdquo; —
              you can reset it from there. Nothing you have recorded on this
              phone is lost either way.
            </Muted>
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
              /*
                A conventional placeholder name, not a real one.
                This read "Sam Karki" — a specific, identifiable person, which
                on a signup form reads as a value already filled in rather
                than as an example. "Jane Smith" is the standing convention
                for exactly this, in the same spirit as `you@example.com` in
                the field below: recognisably a stand-in, and nobody's.
              */
              placeholder="Jane Smith"
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
                // The panel below is about ONE address. Leaving it up while
                // the owner types a different one would answer a question
                // they are no longer asking.
                if (existingAccountEmail) clearExistingAccount();
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
            {/* Feedback only — see validate() above. The account can still be
                created on length alone; this never blocks submission. */}
            {password.length > 0 && <PasswordStrength value={password} />}

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
              /*
                A 555 number, which is the North American range reserved for
                exactly this — it cannot ring a real person, however it is
                dialled. The previous hint was a Nepali +977 prefix, which
                left the form suggesting a country most of its readers are not
                in, next to an American example name.

                The field itself accepts anything: this is a shape, not a
                format the app enforces. Nothing here parses a phone number —
                it is stored as typed and dialled as typed, so an owner
                outside the US who writes their own country code is not
                fighting a validator that only knows one.
              */
              placeholder="+1 555 010 0199"
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
              // Same 555 range as the field above; see the note there.
              placeholder="+1 555 010 0199"
              keyboardType="phone-pad"
              autoComplete="off"
              textContentType="none"
              editable={!busy}
            />
          </View>

          {error && (
            <ErrorNotice
              title={error.title}
              body={error.body}
              onDismiss={() => setError(null)}
              // The only action on this screen is creating the account, so
              // retry unambiguously means "submit again".
              onRetry={
                error.retryable
                  ? () => {
                      setError(null);
                      void onSubmit();
                    }
                  : undefined
              }
              retryLabel="Try again"
            />
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
