/**
 * The code screen. One page, both flows.
 *
 * ── WHY IT IS SHARED ──────────────────────────────────────────────────
 *
 * Signup confirmation and password reset differ in exactly three things: which
 * verb sends the code, which cooldown clock governs resending it, and where
 * the owner goes afterwards. Everything else — the boxes, a resend link, a way
 * out when the mail never arrives — is identical, and two copies of it would
 * be two places for the paste-a-code behaviour to rot.
 *
 * So the mode is a route param and the differences live in one table at the
 * top of the component.
 *
 * ── WHY IT IS NOT THE SIGN-IN SCREEN ──────────────────────────────────
 *
 * It used to be a card that appeared beneath the login form, which meant the
 * screen showed a password field and a code field at once and asked the owner
 * to work out which of them was addressed to them. A code is a single
 * instruction and gets a single screen.
 *
 * ── WHERE IT ENDS ─────────────────────────────────────────────────────
 *
 *   signup -> back to sign in, with a confirmation notice
 *   reset  -> on to /new-password, which ends at sign in the same way
 *
 * A verified code leaves a REAL session behind in both cases (see
 * authStore.confirmSignUp). The store's `handoff` flag is what stops the route
 * gate acting on that session while this screen is still mid-flow.
 */

import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';

import { AuthCard, AuthScaffold } from '@/components/AuthScaffold';
import { OtpInput } from '@/components/OtpInput';
import { Body, Button, Muted } from '@/components/ui';
import { ErrorNotice } from '@/components/ErrorNotice';
import { colors, fontFamily, fontSize, spacing } from '@/theme/tokens';
import { secondsUntil, useAuthStore } from '@/store/authStore';
import { OTP_LENGTH } from '@/constants/auth';

type Mode = 'signup' | 'reset';

export default function VerifyScreen() {
  /*
   * Only the MODE travels in the URL. The address comes from the store.
   *
   * It used to be a param, and expo-router's serialise-to-URL-and-parse-back
   * round trip ate the `+` out of plus-addressed Gmail — see `resetEmail` in
   * authStore. A mode is a two-value enum with nothing to mangle; an email
   * address is owner-supplied text and has no business in a query string.
   */
  const params = useLocalSearchParams<{ mode?: string }>();
  const mode: Mode = params.mode === 'reset' ? 'reset' : 'signup';

  const awaitingConfirmation = useAuthStore((s) => s.awaitingConfirmation);
  const resetEmail = useAuthStore((s) => s.resetEmail);
  const email = (mode === 'reset' ? resetEmail : awaitingConfirmation) ?? '';

  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);
  const confirmSignUp = useAuthStore((s) => s.confirmSignUp);
  const resendSignUpCode = useAuthStore((s) => s.resendSignUpCode);
  const cancelSignUpConfirmation = useAuthStore((s) => s.cancelSignUpConfirmation);
  const verifyResetCode = useAuthStore((s) => s.verifyResetCode);
  const sendPasswordReset = useAuthStore((s) => s.sendPasswordReset);
  const signUpCodeAllowedAt = useAuthStore((s) => s.signUpCodeAllowedAt);
  const resetEmailAllowedAt = useAuthStore((s) => s.resetEmailAllowedAt);

  const [code, setCode] = useState('');
  const [codeError, setCodeError] = useState<string | undefined>();
  /**
   * "A new code is on its way" — shown where the rejection message goes.
   *
   * The pair is deliberately mutually exclusive: the two say opposite things
   * about the digits currently on screen, and showing both at once is how an
   * owner ends up retyping the code that was just superseded.
   */
  const [resent, setResent] = useState(false);

  /** The three things the two flows disagree about. */
  const flow =
    mode === 'reset'
      ? {
          title: 'Enter your reset code',
          allowedAt: resetEmailAllowedAt,
          resend: () => sendPasswordReset(email).then((r) => r !== 'failed'),
          verify: () => verifyResetCode(email, code),
          onVerified: () => router.replace('/new-password'),
        }
      : {
          title: 'Confirm your email',
          allowedAt: signUpCodeAllowedAt,
          resend: () => resendSignUpCode(email),
          verify: () => confirmSignUp(email, code),
          onVerified: () =>
            router.replace({ pathname: '/sign-in', params: { notice: 'confirmed' } }),
        };

  // A once-a-second tick, alive only while the resend cooldown is counting.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (flow.allowedAt === null) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [flow.allowedAt]);
  const resendSeconds = secondsUntil(flow.allowedAt);

  /**
   * Set the moment a code is accepted.
   *
   * Verifying CLEARS the store field this screen reads its address from, so
   * without this the backstop below would fire on the way out and replace the
   * hand-back to sign-in — losing the "Email confirmed" notice with it.
   */
  const verified = useRef(false);

  /*
   * Landing here with no address is a dead screen — there is nothing to verify
   * a code against and no way to resend one. It should be unreachable (both
   * entry points set the address first), so this is a backstop for a deep link
   * or a reload, not a state to design for.
   */
  useEffect(() => {
    if (verified.current) return;
    if (email.length === 0) router.replace('/sign-in');
  }, [email]);

  const onVerify = async () => {
    setError(null);
    setResent(false);
    if (code.trim().length !== OTP_LENGTH) {
      setCodeError(`Enter the ${OTP_LENGTH}-digit code.`);
      return;
    }
    setCodeError(undefined);

    const ok = await flow.verify();
    if (ok) verified.current = true;
    if (!ok) {
      /*
       * ── A REJECTED CODE IS ONE LINE, NOT A PANEL ──────────────────────
       *
       * It used to raise the shared ErrorNotice: an amber card with an icon,
       * a heading, two sentences and a "Try again" button, pushed in below
       * the boxes. That is the right weight for "we could not send your
       * code" and much too much for "those six digits were wrong" — the
       * commonest, most recoverable thing that happens on this screen, and
       * one the owner fixes by looking at their email again. Typing a digit
       * wrong should not make the screen jump.
       *
       * So a rejection is TAKEN out of the store and lowered into the inline
       * slot the length check already uses, then cleared — otherwise the card
       * renders underneath saying the same thing twice.
       *
       * Only a rejection. Anything else that can make verification fail — no
       * connection, too many attempts — keeps the card, because those carry
       * their explanation in the BODY and the inline slot is one line. The
       * store says which this is; see `kind` in services/authErrors.ts.
       */
      const notice = useAuthStore.getState().error;
      const rejected = !notice || notice.kind === 'code-rejected';
      if (rejected) {
        setCodeError(notice ? notice.title : 'That code didn’t work.');
        setError(null);
        // Clear the boxes ONLY here. The digits have just been refused, and
        // leaving them invites the same submission again — but if the call
        // failed for any other reason (no connection, rate limited) the code
        // on screen is probably fine, and wiping it would make the owner
        // retype six digits to recover from our problem, not theirs.
        setCode('');
      }
      return;
    }
    flow.onVerified();
  };

  /**
   * Ask for a new code, and point the owner at the right email.
   *
   * ── THE TWO FLOWS DO NOT BEHAVE THE SAME, AND THE COPY HAS TO SURVIVE
   *    BOTH ────────────────────────────────────────────────────────────
   *
   *   reset   resetPasswordForEmail mints a NEW recovery token and overwrites
   *           the old one. The code in the earlier email is now dead.
   *   signup  GoTrue re-sends the EXISTING confirmation token rather than
   *           generating one (supabase/auth#1300). The "old" code and the new
   *           one are the same digits, so the earlier email still works.
   *
   * Only one code is ever live either way — but "the previous code no longer
   * works" is true for one flow and false for the other, so this screen must
   * not say it. "Use the newest email" is correct in both, and is the only
   * instruction that gets the owner to a code that verifies.
   *
   * ── WHY THE BOXES ARE CLEARED ─────────────────────────────────────────
   *
   * Because of the reset case. Digits typed from a superseded email are now
   * wrong, and leaving them sitting there invites exactly the failure this
   * screen is worst at explaining: a code that is objectively correct, from
   * an email that objectively arrived, being refused with no reason given.
   */
  const onResend = async () => {
    setError(null);
    setCodeError(undefined);
    setResent(false);
    const sent = await flow.resend();
    // `false` covers both a refusal and a cooldown, and the store has already
    // said which in its own words. Claiming a new code in either case would
    // be the app telling the owner to wait for mail that is not coming.
    if (!sent) return;
    setCode('');
    setResent(true);
  };

  const leave = () => {
    // Clearing the pending confirmation, not just navigating, is what stops
    // the sign-in screen bouncing straight back here for an address whose code
    // never arrived. Harmless in reset mode, where nothing is pending.
    cancelSignUpConfirmation();
    setError(null);
    router.replace('/sign-in');
  };

  return (
    <AuthScaffold
      title={flow.title}
      lede={`We sent a ${OTP_LENGTH}-digit code to ${email}. It can take a minute — check your spam folder too.`}
      onBack={leave}
      backLabel="Back to sign in"
    >
      <AuthCard>
        <OtpInput
          length={OTP_LENGTH}
          value={code}
          onChangeText={(v) => {
            setCode(v);
            setCodeError(undefined);
            setResent(false);
          }}
          onComplete={() => void onVerify()}
          error={!!codeError}
          disabled={busy}
          autoFocus
          accessibilityLabel="Verification code"
        />
        {codeError ? (
          <Text style={styles.codeError}>{codeError}</Text>
        ) : resent ? (
          <Text style={styles.codeSent}>
            New code sent — use the newest email.
          </Text>
        ) : null}

        <Button label="Verify" loading={busy} onPress={() => void onVerify()} />

        <Pressable
          onPress={() => void onResend()}
          hitSlop={8}
          disabled={resendSeconds > 0 || busy}
          accessibilityRole="button"
          style={styles.resendRow}
        >
          <Text style={[styles.resend, resendSeconds > 0 && styles.resendWaiting]}>
            {resendSeconds > 0 ? `Resend in ${resendSeconds}s` : 'Resend code'}
          </Text>
        </Pressable>
      </AuthCard>

      {/*
        Only SENDING problems reach this card now — a mailer outage, a
        cooldown, a network failure. A rejected code is handled inline above,
        and onVerify clears the store notice so the two cannot both appear.

        Retry therefore re-SENDS. It used to re-run onVerify, which was right
        when this card also carried code rejections and wrong for everything
        else: pressing "Try again" under "we could not send your code"
        resubmitted the digits instead of asking for new ones.
      */}
      {error && (
        <ErrorNotice
          title={error.title}
          body={error.body}
          onDismiss={() => setError(null)}
          onRetry={
            error.retryable
              ? () => {
                  setError(null);
                  void onResend();
                }
              : undefined
          }
        />
      )}

      <Muted style={styles.note}>
        {mode === 'reset'
          ? 'Once the code checks out you can choose a new password. Your records stay exactly as they are.'
          : 'Nothing you record before then is lost — your dog’s history is saved on this phone and joins your account once you’re in.'}
      </Muted>

      {/*
        The escape hatch. A code that never arrives — spam-filtered, or the
        project's mailer out of turns — must not be a dead end, so there is
        always a way back to a screen that works. Quiet on purpose: Verify and
        Resend are the paths meant to succeed.
      */}
      <Body style={styles.footer}>
        <Text style={styles.link} accessibilityRole="button" onPress={leave}>
          {mode === 'reset' ? 'Cancel and go back' : 'Use a different address'}
        </Text>
      </Body>
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  codeError: {
    fontSize: fontSize.xs,
    color: colors.redDeep,
    fontWeight: '600',
    fontFamily: fontFamily.semibold,
  },
  // Same size and weight as codeError, teal rather than red: it occupies the
  // same slot and must not make the layout jump between the two states.
  codeSent: {
    fontSize: fontSize.xs,
    color: colors.tealDeep,
    fontWeight: '600',
    fontFamily: fontFamily.semibold,
  },
  resendRow: { alignSelf: 'center', paddingVertical: spacing.xs },
  resend: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.teal,
    fontFamily: fontFamily.bold,
  },
  resendWaiting: { color: colors.inkSoft },
  note: { lineHeight: 19, textAlign: 'center' },
  footer: { textAlign: 'center' },
  link: {
    color: colors.inkSoft,
    fontWeight: '600',
    fontFamily: fontFamily.semibold,
    fontSize: fontSize.sm,
  },
});
