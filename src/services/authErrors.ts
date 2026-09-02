/**
 * Turning whatever a sign-in provider threw into something an owner can read.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * The provider SDKs throw developer-facing strings, and they were going
 * straight onto the screen:
 *
 *   "DEVELOPER_ERROR"
 *   "RNGoogleSignin: ..."
 *   "Google did not return an identity token."
 *
 * None of those tell an owner what happened or what to do, and the first two
 * are not even about them — they are about our configuration. A person trying
 * to back up their dog's seizure history reads "DEVELOPER_ERROR" and concludes
 * they broke something.
 *
 * ── CANCELLING IS NOT AN ERROR ────────────────────────────────────────
 *
 * The commonest path through this file returns `null`. Backing out of the
 * Apple or Google sheet is a decision, not a failure, and showing a red panel
 * for it tells the owner they did something wrong when they did exactly what
 * they meant to.
 *
 * Apple's cancellation was already handled in authStore; Google's was NOT, so
 * dismissing the Google sheet raised a red error card. That is the bug this
 * module was written for.
 *
 * ── THE ONE THING IT MUST NOT DO ──────────────────────────────────────
 *
 * Never invent a cause. Where the provider gives us nothing specific, the copy
 * says so plainly and offers the next step, rather than guessing at "check
 * your connection" for what might be a server fault. A wrong explanation costs
 * more than an honest vague one — it sends someone to reset a router when
 * their account is fine.
 *
 * Pure, and free of runtime `@/` imports so `node --test` can load it.
 */

export type AuthProvider = 'apple' | 'google' | 'password';

export type AuthErrorNotice = {
  /** Short, human, no jargon. Sentence case, no trailing full stop. */
  title: string;
  /** One or two sentences: what happened, then what to do. */
  body: string;
  /**
   * Whether pressing the same button again could plausibly work.
   *
   * False for configuration faults — offering "Try again" on a problem that
   * cannot resolve itself is the app wasting the owner's time and hiding that
   * the fault is ours.
   */
  retryable: boolean;
};

/** Pulls a `code` off an unknown throwable without assuming its shape. */
function codeOf(e: unknown): string {
  if (typeof e === 'object' && e !== null && 'code' in e) {
    return String((e as { code?: unknown }).code ?? '');
  }
  return '';
}

function messageOf(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  return '';
}

/**
 * Did the owner back out of the system sheet?
 *
 * The two SDKs disagree on how to say so, and neither is documented in one
 * place, so all the known spellings are matched:
 *
 *   expo-apple-authentication  ERR_REQUEST_CANCELED
 *   google-signin (iOS)        SIGN_IN_CANCELLED, or the raw -5
 *   google-signin (Android)    12501
 *
 * The message check is a deliberate backstop: these constants have changed
 * across major versions of both libraries, and the cost of missing one is an
 * error panel shown to someone who simply changed their mind.
 */
export function isCancellation(e: unknown): boolean {
  const code = codeOf(e);
  if (
    code === 'ERR_REQUEST_CANCELED' ||
    code === 'ERR_CANCELED' ||
    code === 'SIGN_IN_CANCELLED' ||
    code === '-5' ||
    code === '12501'
  ) {
    return true;
  }
  const m = messageOf(e).toLowerCase();

  // The iOS consent sheet — «"PawTrack" Wants to Use "accounts.google.com"» —
  // is ASWebAuthenticationSession, NOT GIDSignIn. Dismissing it does not
  // produce kGIDSignInErrorCodeCanceled; it surfaces as the session's own
  // error 1, wrapped by RNGoogleSignin as "Unknown error in google sign in."
  // with the underlying NSError description attached. Matching the domain and
  // code is specific enough to be safe — nothing else produces that pair.
  if (
    m.includes('webauthenticationsession') &&
    /error\s+1\b/.test(m)
  ) {
    return true;
  }

  return (
    m.includes('cancel') ||
    m.includes('canceled') ||
    m.includes('cancelled')
  );
}

const PROVIDER_NAME: Record<AuthProvider, string> = {
  apple: 'Apple',
  google: 'Google',
  password: 'Email',
};

/**
 * What to show for a failed sign-in, or `null` to show nothing at all.
 *
 * `null` means the owner cancelled. Callers must treat that as "clear the
 * error and carry on", never as "show a generic message".
 */
export function describeAuthError(
  e: unknown,
  provider: AuthProvider,
): AuthErrorNotice | null {
  if (isCancellation(e)) return null;

  const code = codeOf(e);
  const raw = messageOf(e);
  const m = raw.toLowerCase();
  const name = PROVIDER_NAME[provider];

  /* --- Our configuration, not the owner's problem ------------------- */

  // DEVELOPER_ERROR / code 10 is Google telling us the client ids or the
  // signing certificate do not line up. Nothing the owner does will fix it,
  // so it must not offer a retry or blame their account.
  if (code === 'DEVELOPER_ERROR' || code === '10' || m.includes('developer_error')) {
    return {
      title: `${name} sign-in is not set up correctly`,
      body:
        'This is a problem with the app, not with your account. Please use email and password for now — your records are not affected.',
      retryable: false,
    };
  }

  // The audience of the id token is the WEB client id. With it missing or
  // wrong, Google returns a token Supabase will not accept — or no token at
  // all. Both land here.
  if (
    m.includes('did not return an identity token') ||
    m.includes('audience') ||
    m.includes('invalid client') ||
    m.includes('invalid_client') ||
    m.includes('unauthorized_client') ||
    m.includes('unacceptable audience')
  ) {
    return {
      title: `${name} sign-in could not be completed`,
      // Deliberately does NOT claim the sign-in "completed" — this branch is
      // reached both when Google returned nothing usable and when the app's
      // own client ids are wrong, and asserting which one happened would be
      // guessing at the owner.
      body:
        'The app did not get what it needed from Google. This is usually a problem with the app’s setup rather than your account — email and password will still work.',
      retryable: false,
    };
  }

  /* --- Transient, worth another go ---------------------------------- */

  if (
    m.includes('network') ||
    m.includes('fetch') ||
    m.includes('timeout') ||
    m.includes('timed out') ||
    m.includes('offline') ||
    m.includes('connection')
  ) {
    return {
      title: 'No connection',
      body:
        'Your dog’s records are saved on this phone either way. Signing in only adds a backup, so you can do it whenever you are back online.',
      retryable: true,
    };
  }

  // Android only, and genuinely actionable by the owner.
  if (m.includes('play services') || code === '2' || code === 'PLAY_SERVICES_NOT_AVAILABLE') {
    return {
      title: 'Google Play services needs updating',
      body:
        'Update Google Play services from the Play Store, then try again. You can also sign in with email and password.',
      retryable: true,
    };
  }

  /* --- The owner's account ------------------------------------------ */

  if (m.includes('already registered') || m.includes('already exists')) {
    return {
      title: 'That email already has an account',
      body: 'Sign in with your password instead, or reset it if you have forgotten it.',
      retryable: false,
    };
  }

  if (m.includes('rate limit') || m.includes('too many')) {
    return {
      title: 'Too many attempts',
      body: 'Wait a minute and try again. Nothing has been lost.',
      retryable: true,
    };
  }

  /* --- Anything else ------------------------------------------------- */

  // A message we wrote ourselves is already owner-facing (see the password
  // paths in authStore), so it is shown as-is rather than replaced with
  // something vaguer. Ours are sentences; SDK codes are not.
  const looksHumanWritten = /^[A-Z].*[.!?]$/.test(raw.trim()) && !raw.includes('_');
  if (looksHumanWritten) {
    return { title: 'Could not sign in', body: raw.trim(), retryable: true };
  }

  return {
    title: `Could not sign in with ${name}`,
    body:
      'Something went wrong and the app could not say what. Your records are safe on this phone. You can try again, or use email and password.',
    retryable: true,
  };
}
