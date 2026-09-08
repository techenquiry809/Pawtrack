/**
 * Step 1 of a password reset: which address should the code go to.
 *
 * ── WHY THIS IS ITS OWN SCREEN ────────────────────────────────────────
 *
 * It used to be a card that unfolded underneath the sign-in form. That put
 * three different jobs on one screen — sign in, ask for a code, type the code
 * and a new password — with the sign-in button still live above them, and the
 * owner deciding which of the two "submit" buttons applied to them. Someone
 * locked out of a medical diary should be reading one instruction at a time.
 *
 * The address is deliberately NOT carried over from whatever was typed on the
 * sign-in form. If they are here, the thing they were sure about a moment ago
 * has just turned out to be wrong, and starting from an empty field invites
 * them to check it rather than to re-send a code to a typo.
 */

import { useEffect, useState } from 'react';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';

import { AuthCard, AuthScaffold } from '@/components/AuthScaffold';
import { AuthField } from '@/components/AuthField';
import { Button, Muted } from '@/components/ui';
import { ErrorNotice } from '@/components/ErrorNotice';
import { secondsUntil, useAuthStore } from '@/store/authStore';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function ForgotPasswordScreen() {
  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);
  const sendPasswordReset = useAuthStore((s) => s.sendPasswordReset);
  const resetEmailAllowedAt = useAuthStore((s) => s.resetEmailAllowedAt);

  const [email, setEmail] = useState('');
  const [fieldError, setFieldError] = useState<string | undefined>();

  // A once-a-second tick, alive only while the cooldown is actually counting.
  // A disabled button with no explanation is the state that reads as broken.
  const [, setTick] = useState(0);
  useEffect(() => {
    if (resetEmailAllowedAt === null) return;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [resetEmailAllowedAt]);
  const waitSeconds = secondsUntil(resetEmailAllowedAt);

  const onSend = async () => {
    setError(null);
    const trimmed = email.trim();
    if (!EMAIL_RE.test(trimmed)) {
      setFieldError('Enter a valid email address.');
      return;
    }
    setFieldError(undefined);

    /*
     * Only advance when a code is actually coming.
     *
     * 'throttled' still advances: no NEW mail went out, but one did moments
     * ago and is sitting in the inbox, so the owner needs the box to type it
     * into. 'failed' must NOT advance — the server has just said it could not
     * send, and a code screen waiting for mail that does not exist is the
     * dead end this whole flow was rebuilt to remove.
     */
    const outcome = await sendPasswordReset(trimmed);
    if (outcome === 'failed') return;

    // The address is already in the store, put there by sendPasswordReset —
    // it must not travel in the URL. See `resetEmail` in authStore.
    router.push({ pathname: '/verify', params: { mode: 'reset' } });
  };

  return (
    <AuthScaffold
      title="Reset your password"
      lede="We'll email you a 6-digit code. Nothing on this phone is deleted — your dog's records are saved locally either way."
      onBack={() => router.back()}
      backLabel="Back to sign in"
    >
      <AuthCard>
        <AuthField
          label="Email"
          value={email}
          onChangeText={(v) => {
            setEmail(v);
            setFieldError(undefined);
          }}
          placeholder="you@example.com"
          keyboardType="email-address"
          autoComplete="email"
          textContentType="emailAddress"
          error={fieldError}
          editable={!busy}
          returnKeyType="go"
          onSubmitEditing={() => void onSend()}
        />

        <Button
          label={waitSeconds > 0 ? `Send again in ${waitSeconds}s` : 'Send code'}
          loading={busy}
          disabled={waitSeconds > 0}
          onPress={() => void onSend()}
        />

        <Muted style={styles.note}>
          If an account exists for that address, a code is on its way. We
          don&rsquo;t say whether one does — that would let anyone check who is
          registered here.
        </Muted>
      </AuthCard>

      {error && (
        <ErrorNotice
          title={error.title}
          body={error.body}
          onDismiss={() => setError(null)}
          onRetry={
            error.retryable
              ? () => {
                  setError(null);
                  void onSend();
                }
              : undefined
          }
        />
      )}

      {/*
        There is deliberately no "Already have the code? Enter it" shortcut.

        It let someone reach the code screen WITHOUT sending, which sounds
        helpful and is the one route in this flow that can strand a person on
        a dead code. Only one code is ever live per account — a new request
        overwrites the last — so "the code you already have" is only valid if
        nothing has been sent since, and nothing on this screen could know
        whether that was true. The reliable instruction is the same either
        way: send one now and use the newest email.
      */}
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  note: { lineHeight: 19 },
});
