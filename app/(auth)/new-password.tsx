/**
 * Step 3 of a password reset: choose the new password.
 *
 * ── THIS SCREEN HOLDS A LIVE SESSION ──────────────────────────────────
 *
 * Getting here means the code verified, and `verifyOtp({ type: 'recovery' })`
 * exchanged it for a real session — recovery sessions are sessions, not a
 * half-signed-in state. Two consequences, and both are load-bearing:
 *
 *   1. The route gate must stay out of the way, or it would notice a
 *      signed-in user and pull them into the app before they have set the
 *      password they came here to set. That is what `handoff` is for; it is
 *      already up when this screen mounts and comes down when the reset
 *      finishes or is abandoned.
 *
 *   2. Leaving WITHOUT finishing has to end the session. Backing out to sign
 *      in while still holding a valid session would either strand the gate or
 *      quietly let someone into the account with the old password they just
 *      said they could not remember. Every exit from this screen therefore
 *      goes through `abandonPasswordReset`.
 */

import { useEffect, useRef, useState } from 'react';
import { StyleSheet } from 'react-native';
import { router } from 'expo-router';

import { AuthCard, AuthScaffold } from '@/components/AuthScaffold';
import { AuthField } from '@/components/AuthField';
import { Button, Muted } from '@/components/ui';
import { ErrorNotice } from '@/components/ErrorNotice';
import { PasswordStrength } from '@/components/PasswordStrength';
import { MIN_PASSWORD_LENGTH, useAuthStore } from '@/store/authStore';

export default function NewPasswordScreen() {
  // From the store, not the URL — see `resetEmail` in authStore.
  const email = useAuthStore((s) => s.resetEmail) ?? '';

  const busy = useAuthStore((s) => s.busy);
  const error = useAuthStore((s) => s.error);
  const setError = useAuthStore((s) => s.setError);
  const completePasswordReset = useAuthStore((s) => s.completePasswordReset);
  const abandonPasswordReset = useAuthStore((s) => s.abandonPasswordReset);

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [errors, setErrors] = useState<{ password?: string; confirm?: string }>({});

  /**
   * Whether the reset finished here.
   *
   * The unmount cleanup below has to tell "the owner walked away" from "the
   * reset succeeded and navigated on" — both unmount this screen, and only the
   * first one should tear down a session. A ref, not state, because the
   * cleanup reads it after the last render.
   */
  const finished = useRef(false);

  useEffect(() => {
    return () => {
      if (!finished.current) void abandonPasswordReset();
    };
  }, [abandonPasswordReset]);

  const onSubmit = async () => {
    setError(null);
    const next: { password?: string; confirm?: string } = {};
    if (password.length < MIN_PASSWORD_LENGTH) {
      next.password = `Use at least ${MIN_PASSWORD_LENGTH} characters.`;
    }
    if (confirm !== password) next.confirm = 'The two passwords do not match.';
    setErrors(next);
    if (Object.keys(next).length > 0) return;

    const ok = await completePasswordReset(password);
    if (!ok) return;

    // Marked BEFORE navigating: the cleanup above runs on the unmount this
    // navigation causes, and must not undo a reset that worked.
    finished.current = true;
    router.replace({ pathname: '/sign-in', params: { notice: 'reset' } });
  };

  const leave = () => {
    // The effect cleanup discards the recovery session — see the note at the
    // top. This only has to navigate.
    router.replace('/sign-in');
  };

  return (
    <AuthScaffold
      title="Choose a new password"
      lede={
        email.length > 0
          ? `You're resetting the password for ${email}.`
          : 'Pick something you can remember on a bad night.'
      }
      onBack={leave}
      backLabel="Cancel and go back"
    >
      <AuthCard>
        <AuthField
          label="New password"
          value={password}
          onChangeText={(v) => {
            setPassword(v);
            setErrors((e) => ({ ...e, password: undefined }));
          }}
          placeholder={`At least ${MIN_PASSWORD_LENGTH} characters`}
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          error={errors.password}
          editable={!busy}
        />
        {password.length > 0 && <PasswordStrength value={password} />}

        <AuthField
          label="Confirm new password"
          value={confirm}
          onChangeText={(v) => {
            setConfirm(v);
            setErrors((e) => ({ ...e, confirm: undefined }));
          }}
          placeholder="Type it again"
          secure
          autoComplete="new-password"
          textContentType="newPassword"
          error={errors.confirm}
          editable={!busy}
          returnKeyType="go"
          onSubmitEditing={() => void onSubmit()}
        />

        <Button
          label="Save new password"
          loading={busy}
          onPress={() => void onSubmit()}
        />

        <Muted style={styles.note}>
          You&rsquo;ll sign in with this password on the next screen. Other
          devices stay signed in.
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
                  void onSubmit();
                }
              : undefined
          }
        />
      )}
    </AuthScaffold>
  );
}

const styles = StyleSheet.create({
  note: { lineHeight: 19 },
});
