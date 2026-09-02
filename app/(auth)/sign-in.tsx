/**
 * Sign in.
 *
 * Email and password first, then the platform providers, then a link out to
 * manual signup.
 *
 * ── THE TRADE THIS SCREEN MAKES ───────────────────────────────────────
 *
 * The architecture spec preferred a magic link, on the reasoning that a
 * password never stored is a breach that cannot happen. Passwords were chosen
 * instead — a legitimate call, since people expect them and a link that lands
 * in a spam folder is its own kind of lockout.
 *
 * What it costs is a credential store, a reset flow and a permanent
 * credential-stuffing surface. So three things here are load-bearing rather
 * than decorative:
 *
 *   1. "Forgot password" exists. A forgotten password on a medical diary must
 *      never be a dead end.
 *   2. The failure message is deliberately vague. "No account with that email"
 *      would turn this form into an oracle for whether an address belongs to
 *      someone managing a dog's epilepsy.
 *   3. The password field is marked up so password managers can offer to fill
 *      it — see AuthField on why those two props decide whether people end up
 *      with a generated password or a reused one.
 *
 * ── SIGNING IN IS STILL OPTIONAL ──────────────────────────────────────
 *
 * Every record works offline and always has. An account adds backup and a
 * second device, nothing more. "Not now" stays a first-class option.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  Animated,
  Easing,
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
import { Icon } from '@/components/Icon';
import { ErrorNotice } from '@/components/ErrorNotice';
import { AuthField } from '@/components/AuthField';
import { PawTrail } from '@/components/PawTrail';
import { colors, fontFamily, fontSize, radius, shadow, spacing } from '@/theme/tokens';
import { duration, useReducedMotion } from '@/theme/motion';
import {
  accountsAvailable,
  appleSignInAvailable,
  useAuthStore,
  secondsUntil,
} from '@/store/authStore';
import { clearStrandedRowCount, strandedRowCount } from '@/services/sync/devices';
import { dismissAuthPrompt } from '@/services/authPrompt';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignInScreen() {
  const insets = useSafeAreaInsets();
  const reduced = useReducedMotion();

  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const awaitingConfirmation = useAuthStore((s) => s.awaitingConfirmation);
  const signInWithApple = useAuthStore((s) => s.signInWithApple);
  const signInWithGoogle = useAuthStore((s) => s.signInWithGoogle);
  const signInWithPassword = useAuthStore((s) => s.signInWithPassword);
  const sendPasswordReset = useAuthStore((s) => s.sendPasswordReset);
  const setError = useAuthStore((s) => s.setError);
  const signInBlockedUntil = useAuthStore((s) => s.signInBlockedUntil);
  const resetEmailAllowedAt = useAuthStore((s) => s.resetEmailAllowedAt);

  /*
   * A once-a-second tick, alive only while something is actually counting
   * down. A disabled button with no explanation is the state that reads as a
   * broken app, so the label carries the remaining seconds — and the interval
   * exists solely to keep that number honest.
   */
  const [, setTick] = useState(0);
  const counting = signInBlockedUntil !== null || resetEmailAllowedAt !== null;
  useEffect(() => {
    if (!counting) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [counting]);

  const blockedSeconds = secondsUntil(signInBlockedUntil);
  const resetSeconds = secondsUntil(resetEmailAllowedAt);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fieldErrors, setFieldErrors] = useState<{ email?: string; password?: string }>({});
  const [resetSent, setResetSent] = useState(false);
  const [stranded, setStranded] = useState(0);

  useEffect(() => {
    // Reads SQLite, so it can reject, and it can resolve after the owner has
    // already tapped "Not now" and left. Zero is the right fallback: the
    // stranded-rows notice simply does not appear.
    let cancelled = false;
    void strandedRowCount()
      .then((n) => {
        if (!cancelled) setStranded(n);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  /* ---- Entrance ---------------------------------------------------- */
  const enter = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    if (reduced) {
      enter.setValue(1);
      return;
    }
    const anim = Animated.timing(enter, {
      toValue: 1,
      duration: duration.enter,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [enter, reduced]);

  const rise = {
    opacity: enter,
    transform: [
      { translateY: enter.interpolate({ inputRange: [0, 1], outputRange: [14, 0] }) },
    ],
  };

  /* ---- Actions ----------------------------------------------------- */
  const validate = () => {
    const next: { email?: string; password?: string } = {};
    if (!EMAIL_RE.test(email.trim())) next.email = 'Enter a valid email address.';
    if (password.length === 0) next.password = 'Enter your password.';
    setFieldErrors(next);
    return Object.keys(next).length === 0;
  };

  /**
   * The action to repeat if the owner presses "Try again".
   *
   * Held rather than inferred: the error card sits above the provider buttons
   * and below the password form, so there is no way to tell from the error
   * alone which of the three the owner had pressed. Retrying the wrong one is
   * worse than not offering retry.
   */
  const lastAttempt = useRef<(() => Promise<void>) | null>(null);

  const attempt = useCallback(async (run: () => Promise<void>) => {
    lastAttempt.current = run;
    await run();
  }, []);

  const onSignIn = async () => {
    setError(null);
    if (!validate()) return;
    await attempt(() => signInWithPassword(email, password));
  };

  const onForgot = async () => {
    setError(null);
    if (!EMAIL_RE.test(email.trim())) {
      setFieldErrors({ email: 'Enter your email address first, then tap this.' });
      return;
    }
    await sendPasswordReset(email);
    setResetSent(true);
  };

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
          {/* ---- Hero ------------------------------------------------ */}
          <View style={styles.hero}>
            <PawTrail height={92} />
            <Animated.View style={[styles.heroText, rise]}>
              <View style={styles.mark}>
                <Icon name="profile" size="lg" color={colors.tealDeep} filled />
              </View>
              <Title style={styles.headline}>Welcome back</Title>
              <Muted style={styles.lede}>
                Sign in to back up your dog&rsquo;s history and open it on any
                of your devices.
              </Muted>
            </Animated.View>
          </View>

          {stranded > 0 && (
            <Animated.View style={[styles.card, styles.noticeCard, rise]}>
              <Heading>This device was signed out</Heading>
              <Body style={styles.cardBody}>
                {stranded === 1
                  ? '1 record hadn’t synced yet. It is still on this phone.'
                  : `${stranded} records hadn’t synced yet. They are still on this phone.`}{' '}
                Sign in again to save {stranded === 1 ? 'it' : 'them'} to your
                account.
              </Body>
              <Button
                label="Got it"
                variant="ghost"
                onPress={() => {
                  void clearStrandedRowCount();
                  setStranded(0);
                }}
              />
            </Animated.View>
          )}

          {!accountsAvailable() ? (
            <Animated.View style={[styles.card, rise]}>
              <Heading>Accounts aren&rsquo;t set up in this build</Heading>
              <Body style={styles.cardBody}>
                The app works exactly as it always has — everything is saved on
                this phone. Backup and multi-device sync need a Supabase
                project configured.
              </Body>
              <Button
                label="Continue"
                onPress={() => {
                  void dismissAuthPrompt();
                  router.replace('/(tabs)');
                }}
              />
            </Animated.View>
          ) : (
            <Animated.View style={[styles.stack, rise]}>
              {/* ---- Email + password --------------------------------- */}
              <View style={styles.card}>
                <AuthField
                  label="Email"
                  value={email}
                  onChangeText={(v) => {
                    setEmail(v);
                    setFieldErrors((f) => ({ ...f, email: undefined }));
                  }}
                  placeholder="you@example.com"
                  keyboardType="email-address"
                  autoComplete="email"
                  textContentType="emailAddress"
                  error={fieldErrors.email}
                  editable={!busy}
                  returnKeyType="next"
                />

                <AuthField
                  label="Password"
                  value={password}
                  onChangeText={(v) => {
                    setPassword(v);
                    setFieldErrors((f) => ({ ...f, password: undefined }));
                  }}
                  placeholder="Your password"
                  secure
                  // `password`, not `newPassword` — this is what makes a
                  // manager offer an EXISTING credential rather than generate.
                  autoComplete="current-password"
                  textContentType="password"
                  error={fieldErrors.password}
                  editable={!busy}
                  returnKeyType="go"
                  onSubmitEditing={() => void onSignIn()}
                />

                <Button
                  label={
                    blockedSeconds > 0 ? `Try again in ${blockedSeconds}s` : 'Sign in'
                  }
                  onPress={() => void onSignIn()}
                  loading={busy}
                  disabled={blockedSeconds > 0}
                />

                <Pressable
                  onPress={() => void onForgot()}
                  hitSlop={8}
                  accessibilityRole="button"
                  disabled={resetSeconds > 0}
                  style={styles.forgot}
                >
                  <Text
                    style={[styles.forgotText, resetSeconds > 0 && styles.forgotWaiting]}
                  >
                    {resetSeconds > 0
                      ? `You can send another email in ${resetSeconds}s`
                      : 'Forgot your password?'}
                  </Text>
                </Pressable>
              </View>

              {/*
                Confirmation and reset both end in "go and read your email", so
                they share a treatment. Being specific about WHICH email was
                sent is what stops the owner hunting for the wrong one.
              */}
              {resetSent && (
                <View style={[styles.card, styles.infoCard]}>
                  <Heading>Check your email</Heading>
                  <Body style={styles.cardBody}>
                    If an account exists for{' '}
                    <Text style={styles.strong}>{email.trim()}</Text>, we&rsquo;ve
                    sent a link to reset the password.
                  </Body>
                </View>
              )}

              {awaitingConfirmation && !resetSent && (
                <View style={[styles.card, styles.infoCard]}>
                  <Heading>Confirm your email first</Heading>
                  <Body style={styles.cardBody}>
                    We sent a confirmation link to{' '}
                    <Text style={styles.strong}>{awaitingConfirmation}</Text>.
                    Open it and then sign in here.
                  </Body>
                </View>
              )}

              {error && (
                <ErrorNotice
                  title={error.title}
                  body={error.body}
                  onDismiss={() => setError(null)}
                  onRetry={
                    error.retryable && lastAttempt.current
                      ? () => {
                          setError(null);
                          void lastAttempt.current?.();
                        }
                      : undefined
                  }
                />
              )}

              {/* ---- Providers --------------------------------------- */}
              <View style={styles.divider}>
                <View style={styles.rule} />
                <Muted style={styles.dividerLabel}>or continue with</Muted>
                <View style={styles.rule} />
              </View>

              <View style={styles.providers}>
                {/*
                  Apple is present whenever Google is — App Store guideline 4.8
                  requires the equivalent privacy-preserving option, and its
                  absence is a guaranteed rejection rather than a risk.
                */}
                {appleSignInAvailable() && (
                  <ProviderButton
                    label="Apple"
                    glyph=""
                    tone="dark"
                    disabled={busy}
                    onPress={() => void attempt(signInWithApple)}
                  />
                )}
                <ProviderButton
                  label="Google"
                  glyph="G"
                  tone="light"
                  disabled={busy}
                  onPress={() => void attempt(signInWithGoogle)}
                />
              </View>

              {/* ---- Sign up ----------------------------------------- */}
              <View style={styles.signupRow}>
                <Muted>New here?</Muted>
                <Pressable
                  onPress={() => router.push('/sign-up')}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Create an account"
                >
                  <Text style={styles.signupLink}>Create an account</Text>
                </Pressable>
              </View>
            </Animated.View>
          )}

          {/* ---- Skip ------------------------------------------------ */}
          <View style={styles.skip}>
            <Button
              label="Not now"
              variant="ghost"
              onPress={() => {
                void dismissAuthPrompt();
                router.replace('/(tabs)');
              }}
            />
            <Muted style={styles.skipNote}>
              You can sign in later from More. Nothing you record before then
              is lost — it&rsquo;s added to your account when you do.
            </Muted>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/* ------------------------------------------------------------------ */

/**
 * A provider button carrying the platform's own mark.
 *
 * Side by side rather than full width, because they are now the SECONDARY path
 * — the primary one is the form above. A full-width provider button under a
 * full-width "Sign in" reads as three equal choices.
 */
function ProviderButton({
  label,
  glyph,
  tone,
  disabled,
  onPress,
}: {
  label: string;
  glyph: string;
  tone: 'dark' | 'light';
  disabled: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const reduced = useReducedMotion();

  const to = (value: number) => {
    if (reduced) return;
    Animated.timing(scale, {
      toValue: value,
      duration: duration.press,
      easing: Easing.out(Easing.quad),
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[styles.providerWrap, { transform: [{ scale }] }]}>
      <Pressable
        onPress={onPress}
        onPressIn={() => to(0.97)}
        onPressOut={() => to(1)}
        disabled={disabled}
        hitSlop={{ top: 6, bottom: 6 }}
        accessibilityRole="button"
        accessibilityLabel={`Continue with ${label}`}
        accessibilityState={{ disabled }}
        style={[
          styles.provider,
          tone === 'dark' ? styles.providerDark : styles.providerLight,
          disabled && styles.providerDisabled,
        ]}
      >
        <Text
          style={[
            styles.providerGlyph,
            tone === 'dark' ? styles.onDark : styles.onLight,
          ]}
        >
          {glyph}
        </Text>
        <Text
          style={[
            styles.providerLabel,
            tone === 'dark' ? styles.onDark : styles.onLight,
          ]}
        >
          {label}
        </Text>
      </Pressable>
    </Animated.View>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },

  hero: { marginBottom: spacing.xs },
  heroText: { gap: spacing.sm, marginTop: -spacing.xl },
  mark: {
    width: 48,
    height: 48,
    borderRadius: radius.card,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    marginBottom: spacing.xs,
    shadowColor: '#20293A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  headline: { lineHeight: 34 },
  lede: { lineHeight: 21 },

  stack: { gap: spacing.md },

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
  noticeCard: { backgroundColor: colors.amberTint, gap: spacing.sm },
  infoCard: { backgroundColor: colors.tealTint, gap: spacing.sm },
  cardBody: { lineHeight: 21 },
  strong: { fontWeight: '700', color: colors.ink, fontFamily: fontFamily.bold },

  forgot: { alignSelf: 'center', paddingVertical: spacing.xs },
  forgotWaiting: { color: colors.inkSoft },
  forgotText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.teal, fontFamily: fontFamily.bold },

  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.xs,
  },
  rule: { flex: 1, height: 1, backgroundColor: colors.line },
  dividerLabel: { fontSize: fontSize.sm, fontFamily: fontFamily.regular },

  providers: { flexDirection: 'row', gap: spacing.sm },
  providerWrap: { flex: 1 },
  /**
   * Geometry follows the shared Button (shadcn `outline`, default size): the
   * same rounded-lg corner, the same 36pt painted height, the same shadow-sm.
   * Only the fills stay provider-specific — Apple's mark has to sit on black.
   *
   * The 36pt box is under MIN_TOUCH_TARGET, so the Pressable carries hitSlop
   * to restore a 48pt tap area, exactly as Button does.
   */
  provider: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    minHeight: 36,
    borderRadius: radius.control,
    ...shadow.button,
  },
  providerDark: { backgroundColor: colors.ink },
  providerLight: {
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  providerDisabled: { opacity: 0.5 },
  providerGlyph: { fontSize: fontSize.lg, fontWeight: '700', fontFamily: fontFamily.bold },
  /** shadcn: text-sm font-medium. */
  providerLabel: { fontSize: fontSize.base, fontWeight: '500', fontFamily: fontFamily.medium },
  onDark: { color: colors.onMedia },
  onLight: { color: colors.ink },

  signupRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  signupLink: { fontSize: fontSize.md, fontWeight: '800', color: colors.tealDeep, fontFamily: fontFamily.extrabold },

  skip: { gap: spacing.xs, alignItems: 'center', marginTop: spacing.xs },
  skipNote: { textAlign: 'center', lineHeight: 19 },
});
