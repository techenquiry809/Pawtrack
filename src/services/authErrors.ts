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
  /**
   * Set only for "the code you typed was refused".
   *
   * Lets a screen render this one case at a different weight. /verify shows it
   * as a single line under the boxes rather than as the full amber card: a
   * mistyped digit is the commonest and most recoverable thing that happens
   * there, and giving it the same panel as a mail-server outage makes the
   * screen shout at someone who simply needs to look at their email again.
   *
   * Deliberately a FLAG rather than the screen matching on the title. Copy
   * gets reworded; a match on it fails silently the first time it does, and
   * fails by showing the wrong thing rather than by not compiling.
   */
  kind?: 'code-rejected';
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
 * Google's "your OAuth setup is wrong", by any of its spellings.
 *
 * DEVELOPER_ERROR is raised by Play Services when the app asking for a token
 * does not match any OAuth client in the Google Cloud project. It is ALWAYS a
 * build-configuration fault and never anything the owner did, and its three
 * causes are all invisible from inside the app:
 *
 *   - no Android OAuth client for this applicationId at all
 *   - a client whose package name is stale — this app's applicationId changed
 *     from com.pawtrack.app to com.pawtrack.ausasi during release prep, and a
 *     client left on the old name produces exactly this
 *   - a client whose SHA-1 is not the certificate the running build is signed
 *     with. Play App Signing re-signs the uploaded AAB with Google's own key,
 *     so a build installed from Play has a DIFFERENT fingerprint from the one
 *     that left this machine, and both have to be registered
 *
 * Exported so the store can say all of that to the developer's console while
 * the owner is shown the calm version. See docs/GOOGLE_SIGNIN.md.
 */
export function isProviderMisconfiguration(e: unknown): boolean {
  const code = codeOf(e);
  return (
    code === 'DEVELOPER_ERROR' ||
    code === '10' ||
    messageOf(e).toLowerCase().includes('developer_error')
  );
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

/** Which screen the message will appear on. See describeAuthError. */
export type AuthContext = 'sign-in' | 'sign-up';

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
  /**
   * Which flow the owner is actually in.
   *
   * Without this every message said "sign in", including the ones shown on
   * the CREATE ACCOUNT screen — so a failed signup was reported as "Could not
   * sign in with Email. …You can try again, or use email and password", to
   * someone who was signing up, with email and password. Three wrong things
   * in two sentences.
   */
  context: AuthContext = 'sign-in',
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
  if (isProviderMisconfiguration(e)) {
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

  // Supabase's verifyOtp error for a wrong or stale code. Named separately
  // from "Anything else" below because the fix is specific — a fresh code —
  // not the generic "try again" the fallback offers.
  /*
   * OUR MAIL DID NOT GO OUT.
   *
   * GoTrue reports a failed send as a 500 with "Error sending confirmation
   * email" / "Error sending recovery email" and no further detail. Without
   * this branch it fell through to the generic fallback below and became
   * "something went wrong and the app could not say what" — which was doubly
   * unhelpful, because the app CAN say what: no email is coming, so there is
   * no point watching an inbox.
   *
   * Naming it does not leak whether the address has an account: GoTrue
   * answers an unknown address with a silent 200 and never reaches this
   * branch, so it only ever fires when our own mail delivery is broken.
   */
  if (m.includes('error sending')) {
    const what = m.includes('recovery') ? 'reset code' : 'confirmation code';
    return {
      title: `Could not send your ${what}`,
      body:
        `Something went wrong on our side and the email was not sent, so no ${what} is coming. ` +
        'Please try again in a moment — if it keeps happening, contact support.',
      retryable: true,
    };
  }

  if (m.includes('token') && (m.includes('expired') || m.includes('invalid'))) {
    return {
      title: 'That code didn’t work',
      body: 'It may be wrong or may have expired. Check your email for the most recent code, or send a new one.',
      retryable: true,
      kind: 'code-rejected',
    };
  }

  /* --- Anything else ------------------------------------------------- */

  // A message we wrote ourselves is already owner-facing (see the password
  // paths in authStore), so it is shown as-is rather than replaced with
  // something vaguer. Ours are sentences; SDK codes are not.
  const looksHumanWritten = /^[A-Z].*[.!?]$/.test(raw.trim()) && !raw.includes('_');
  const action = context === 'sign-up' ? 'create your account' : 'sign in';

  if (looksHumanWritten) {
    return { title: `Could not ${action}`, body: raw.trim(), retryable: true };
  }

  /*
   * The last resort. Two things it must NOT do any more:
   *
   *   - Tell someone using email and password to "use email and password".
   *     That advice only makes sense as a fallback FROM Apple or Google, so
   *     it is now offered only when there is somewhere else to fall back to.
   *   - Claim "your records are safe on this phone". That was true when an
   *     account was optional and local records existed before sign-in. An
   *     account is required now, so on this screen there are usually no
   *     records yet and the reassurance is about nothing.
   */
  if (provider === 'password') {
    return {
      title: `Could not ${action}`,
      body: 'Something went wrong and the app could not say what. Please check your connection and try again.',
      retryable: true,
    };
  }

  return {
    title: `Could not ${action} with ${name}`,
    body:
      'Something went wrong and the app could not say what. You can try again, or use email and password instead.',
    retryable: true,
  };
}

/**
 * Did signUp() just refuse an address that already has a CONFIRMED account?
 *
 * ── THE RESPONSE THIS READS ───────────────────────────────────────────
 *
 * With email confirmation required, GoTrue does NOT return an error for an
 * existing confirmed email. It returns 200 with a user-shaped object, on
 * purpose, so the endpoint cannot be used to enumerate accounts. The only
 * thing separating that obfuscated user from a real new signup is
 * `identities`: a genuine signup carries one, this carries an empty array.
 *
 * ── WHY THE CHECK IS THIS PEDANTIC ────────────────────────────────────
 *
 * `!user.identities?.length` is the obvious spelling and it is wrong in the
 * dangerous direction. `identities` is optional in the SDK's type and is
 * absent — not empty — on some responses, so the short form fires on a shape
 * that merely omitted the field and refuses a legitimate signup with "you
 * already have an account", locking a new owner out of creating one.
 *
 * So: an ARRAY, and empty. Absent means "no information", which is not the
 * same answer and must fall through to the normal path.
 *
 * Pure and exported so the discriminator can be tested against recorded
 * response shapes without standing up an auth server.
 */
export function isExistingAccountSignUp(user: unknown): boolean {
  if (typeof user !== 'object' || user === null) return false;
  const identities = (user as { identities?: unknown }).identities;
  return Array.isArray(identities) && identities.length === 0;
}
