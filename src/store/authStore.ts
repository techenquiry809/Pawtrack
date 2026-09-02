/**
 * Authentication state.
 *
 * Sits alongside appStore rather than inside it: the dog list and the settings
 * are about the DATA, this is about who is allowed to see it, and the root
 * layout needs the second resolved before it can decide what to render.
 *
 * ── THREE STATES, NOT TWO ─────────────────────────────────────────────
 *
 *   loading      session restore is in flight
 *   signed-out   no session
 *   signed-in    session restored or freshly obtained
 *
 * The third state is the one people forget. Rendering the app while `loading`
 * flashes the onboarding screen at every returning user for a few hundred
 * milliseconds, because the dog list has not been fenced to an owner yet and
 * momentarily looks empty.
 */

import { create } from 'zustand';
import { Platform } from 'react-native';
import type { Session, User } from '@supabase/supabase-js';
import {
  getSupabase,
  isSyncConfigured,
  GOOGLE_WEB_CLIENT_ID,
  GOOGLE_IOS_CLIENT_ID,
} from '@/services/supabase';
import { setActiveUserId } from '@/db/scope';
import { getDb } from '@/db/client';
import * as outbox from '@/db/outbox';
import { describeClaim, type ClaimSituation } from '@/services/sync/claim';
import { describeAuthError, type AuthErrorNotice } from '@/services/authErrors';
import { RESET_COOLDOWN_MS, secondsUntil, signInBackoffMs } from './authThrottle';
export { secondsUntil, signInBackoffMs } from './authThrottle';

export type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

/**
 * What the manual signup form collects.
 *
 * Only name, email and password are required. Everything else is optional and
 * the form says so — this app already holds veterinary health records, and
 * every extra personal field is one more thing to lose in a breach.
 */
export type SignUpInput = {
  fullName: string;
  email: string;
  password: string;
  phone?: string;
  emergencyContactName?: string;
  emergencyContactPhone?: string;
};

/**
 * The shortest password we will accept.
 *
 * Supabase's own default is 6, which is too short to be worth having. Length
 * is the only property that reliably matters, so this asks for length rather
 * than for a symbol and a digit — composition rules mostly produce
 * `Password1!` and a note on the fridge.
 */
export const MIN_PASSWORD_LENGTH = 10;

type AuthState = {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  /**
   * Set after a sign-in that found unclaimed local records AND an account that
   * already has dogs. The root layout routes to the claim screen while this is
   * non-null; nothing is merged until the owner chooses.
   */
  pendingClaim: ClaimSituation | null;
  /**
   * Consecutive failed password attempts, and when the next one is allowed.
   * A UX affordance only — see the note on signInBackoffMs above.
   */
  failedAttempts: number;
  signInBlockedUntil: number | null;
  /** When the next password-reset email may be sent. */
  resetEmailAllowedAt: number | null;

  /**
   * Last auth error, as something the screen can render properly.
   *
   * A structured notice rather than a bare string: the UI needs a title to
   * scan, a body to read, and to know whether offering "Try again" is honest.
   * `null` covers both "nothing went wrong" and "the owner cancelled" — see
   * services/authErrors.ts for why those are the same state.
   */
  error: AuthErrorNotice | null;
  busy: boolean;

  /**
   * Set when a signup succeeded but the account cannot be used yet because the
   * project requires email confirmation. Without surfacing this the flow looks
   * like it worked and then the first sign-in fails with "Email not
   * confirmed", which reads as a bug in the app rather than an unread email.
   */
  awaitingConfirmation: string | null;

  initialize: () => Promise<() => void>;
  signInWithApple: () => Promise<void>;
  signInWithGoogle: () => Promise<void>;
  signInWithPassword: (email: string, password: string) => Promise<void>;
  signUpWithPassword: (input: SignUpInput) => Promise<void>;
  sendPasswordReset: (email: string) => Promise<boolean>;
  signOut: () => Promise<void>;
  clearPendingClaim: () => void;
  setError: (message: AuthErrorNotice | null) => void;
};

/**
 * Applying a session is more than storing it.
 *
 * `setActiveUserId` is what every repository read filters on, so it has to
 * move in lockstep with the session or a screen will briefly query with the
 * wrong owner — showing the previous user's dog, or none at all.
 */
function applySession(session: Session | null): void {
  setActiveUserId(session?.user.id ?? null);
}

export const useAuthStore = create<AuthState>((set) => ({
  status: 'loading',
  session: null,
  user: null,
  pendingClaim: null,
  awaitingConfirmation: null,
  failedAttempts: 0,
  signInBlockedUntil: null,
  resetEmailAllowedAt: null,
  error: null,
  busy: false,

  /**
   * Restore the persisted session and subscribe to changes.
   *
   * Returns a teardown function. Call once from the root layout.
   */
  initialize: async () => {
    const supabase = getSupabase();

    // A build with no Supabase config is the app exactly as it shipped before
    // accounts existed: fully usable, permanently signed out, nothing to sync.
    if (!supabase) {
      applySession(null);
      set({ status: 'signed-out', session: null, user: null });
      return () => {};
    }

    const { data, error } = await supabase.auth.getSession();
    if (error) console.warn('[auth] could not restore session', error.message);

    applySession(data.session ?? null);
    set({
      status: data.session ? 'signed-in' : 'signed-out',
      session: data.session ?? null,
      user: data.session?.user ?? null,
    });

    const { data: sub } = supabase.auth.onAuthStateChange((event, session) => {
      applySession(session);
      set({
        status: session ? 'signed-in' : 'signed-out',
        session,
        user: session?.user ?? null,
      });

      // A fresh sign-in is the moment to work out whether this phone is
      // carrying records that belong to nobody yet.
      if (event === 'SIGNED_IN' && session) {
        void describeClaim()
          .then((situation) => {
            if (situation.needsDecision) set({ pendingClaim: situation });
          })
          .catch((e) => console.warn('[auth] claim check failed', e));
      }

      if (event === 'SIGNED_OUT') {
        set({ pendingClaim: null, awaitingConfirmation: null });
      }

      // A confirmed sign-in is the first chance to move the signup details out
      // of user_metadata and into the profiles table, where they are covered
      // by RLS and a NOT NULL.
      if (event === 'SIGNED_IN' && session) {
        void reconcileProfile(session.user);
      }
    });

    return () => sub.subscription.unsubscribe();
  },

  /**
   * Sign in with Apple.
   *
   * MANDATORY once Google is offered — App Store guideline 4.8. Not a
   * preference: an app with Google sign-in and no Apple equivalent is rejected.
   *
   * Uses the NATIVE id-token flow rather than Supabase's web OAuth redirect.
   * The redirect bounces the user out to a browser and back, which is slower
   * and loses the platform's own account picker.
   */
  signInWithApple: async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    set({ busy: true, error: null });
    try {
      const AppleAuthentication = await import('expo-apple-authentication');
      const credential = await AppleAuthentication.signInAsync({
        requestedScopes: [
          AppleAuthentication.AppleAuthenticationScope.FULL_NAME,
          AppleAuthentication.AppleAuthenticationScope.EMAIL,
        ],
      });

      if (!credential.identityToken) {
        throw new Error('Apple did not return an identity token.');
      }

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'apple',
        token: credential.identityToken,
      });
      if (error) throw new Error(error.message);
    } catch (e) {
      // Cancellation, provider codes and our own messages are all decided in
      // one place now, so Apple and Google cannot drift apart again.
      set({ error: describeAuthError(e, 'apple') });
    } finally {
      set({ busy: false });
    }
  },

  /** Google, also via the native id-token flow. */
  signInWithGoogle: async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    set({ busy: true, error: null });
    try {
      const { GoogleSignin } = await import(
        '@react-native-google-signin/google-signin'
      );

      GoogleSignin.configure({
        // The WEB client id is what Supabase validates the token's audience
        // against, so it is required even though there is no web build.
        webClientId: GOOGLE_WEB_CLIENT_ID,
        iosClientId: GOOGLE_IOS_CLIENT_ID || undefined,
      });

      await GoogleSignin.hasPlayServices();
      const response = await GoogleSignin.signIn();

      /*
       * CANCELLATION RESOLVES HERE. IT DOES NOT THROW.
       *
       * The library returns a discriminated union, and backing out of the
       * sheet gives `{ type: 'cancelled', data: null }` — a normal resolved
       * value, not a rejection.
       *
       * The previous line was:
       *
       *   const idToken = 'data' in response ? response.data?.idToken : null;
       *
       * `'data' in response` is TRUE for the cancelled shape, so it read
       * `null?.idToken`, got undefined, and fell into the throw below —
       * manufacturing "Google did not return an identity token" out of a
       * deliberate choice. That is what put an error panel in front of anyone
       * who changed their mind, and no amount of message-matching downstream
       * could undo it: the information was already destroyed here.
       */
      if (response.type !== 'success') {
        set({ error: null });
        return;
      }

      const idToken = response.data?.idToken;
      if (!idToken) throw new Error('Google did not return an identity token.');

      const { error } = await supabase.auth.signInWithIdToken({
        provider: 'google',
        token: idToken,
      });
      if (error) throw new Error(error.message);
    } catch (e) {
      // Previously this set the raw thrown message with no cancellation check,
      // so dismissing the Google sheet raised a red panel reading things like
      // "DEVELOPER_ERROR" at someone who had simply changed their mind.
      set({ error: describeAuthError(e, 'google') });
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Email and password.
   *
   * ── A NOTE ON THE TRADE BEING MADE ────────────────────────────────────
   *
   * The architecture spec preferred a magic link precisely because a password
   * never stored is a breach that cannot happen. Passwords were chosen anyway,
   * which is a legitimate product call — people expect them, and a link that
   * lands in spam is its own kind of lockout. What it costs is a credential
   * store, a reset flow, and a permanent credential-stuffing surface, so the
   * mitigations below are not optional decoration:
   *
   *   - a real length minimum (MIN_PASSWORD_LENGTH)
   *   - a reset flow that actually exists, because a forgotten password on a
   *     medical diary must never be a dead end
   *   - errors that do not confirm whether an address has an account
   */
  signInWithPassword: async (email: string, password: string) => {
    const supabase = getSupabase();
    if (!supabase) return;

    // Refuse locally while the backoff is running, so the attempt never
    // reaches the server and the countdown the screen shows stays truthful.
    const blockedUntil = useAuthStore.getState().signInBlockedUntil;
    const waitSeconds = secondsUntil(blockedUntil);
    if (waitSeconds > 0) {
      set({
        error: {
          title: 'Too many attempts',
          body: `Wait ${waitSeconds} ${waitSeconds === 1 ? 'second' : 'seconds'} and try again. Nothing has been lost — your records are on this phone either way.`,
          retryable: false,
        },
      });
      return;
    }

    set({ busy: true, error: null, awaitingConfirmation: null });
    try {
      const { error } = await supabase.auth.signInWithPassword({
        email: email.trim().toLowerCase(),
        password,
      });
      if (error) {
        // Supabase distinguishes these two, and the difference matters to the
        // owner: one means "try again", the other means "go and read your
        // email". Anything else stays vague on purpose — a message that
        // confirms an address has an account is an account-enumeration oracle.
        const message = error.message.toLowerCase();
        if (message.includes('not confirmed')) {
          set({ awaitingConfirmation: email.trim().toLowerCase() });
          throw new Error(
            'Confirm your email address first — check your inbox for the link we sent.',
          );
        }
        throw new Error('That email and password do not match.');
      }
      // Clean sign-in clears the backoff; the next wrong password starts over.
      set({ failedAttempts: 0, signInBlockedUntil: null });
    } catch (e) {
      // Only a WRONG CREDENTIAL counts toward the backoff. "Confirm your email
      // first" is a correct password on an unconfirmed account — throttling it
      // would lock someone out of the one screen that tells them to go and
      // click the link, which is the opposite of what the backoff is for.
      if (useAuthStore.getState().awaitingConfirmation === null) {
        const failures = useAuthStore.getState().failedAttempts + 1;
        const backoff = signInBackoffMs(failures);
        set({
          failedAttempts: failures,
          signInBlockedUntil: backoff > 0 ? Date.now() + backoff : null,
        });
      }
      // The password paths above throw messages already written for owners,
      // and describeAuthError passes those straight through.
      set({ error: describeAuthError(e, 'password') });
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Create an account, then write the profile.
   *
   * Two steps, and deliberately not one: the profile row is written AFTER the
   * account exists, because `profiles.user_id` is a foreign key to auth.users
   * and RLS keys the insert on auth.uid().
   *
   * When the project requires email confirmation there is no session yet, so
   * the profile cannot be written at all — the details are carried in
   * `options.data` and reconciled on first sign-in instead. That is the only
   * thing user_metadata is used for here: a staging area for data nobody makes
   * a trust decision on.
   */
  signUpWithPassword: async (input: SignUpInput) => {
    const supabase = getSupabase();
    if (!supabase) return;
    set({ busy: true, error: null, awaitingConfirmation: null });

    const email = input.email.trim().toLowerCase();
    const profile = {
      full_name: input.fullName.trim(),
      phone: input.phone?.trim() ?? '',
      emergency_contact_name: input.emergencyContactName?.trim() ?? '',
      emergency_contact_phone: input.emergencyContactPhone?.trim() ?? '',
    };

    try {
      const { data, error } = await supabase.auth.signUp({
        email,
        password: input.password,
        options: { data: profile },
      });
      if (error) throw new Error(error.message);

      if (data.session) {
        // Auto-confirm is on: we have a session, so write the real row now.
        await writeProfile(profile);
      } else {
        // Confirmation required. Nothing more can happen until they click the
        // link, and saying so is the whole point of this state.
        set({ awaitingConfirmation: email });
      }
    } catch (e) {
      set({ error: describeAuthError(e, 'password') });
    } finally {
      set({ busy: false });
    }
  },

  /**
   * Send a password reset email.
   *
   * Always reports success, whatever happened. "No account with that email"
   * would turn this box into an account-enumeration oracle: anyone could feed
   * it addresses and learn which belong to people managing a dog's epilepsy.
   */
  sendPasswordReset: async (email: string) => {
    const supabase = getSupabase();
    if (!supabase) return true;

    // Each press sends MAIL. The cooldown is what stops a mashed button from
    // filling someone's inbox — including someone who is not the person
    // pressing it, since the address is whatever was typed.
    const wait = secondsUntil(useAuthStore.getState().resetEmailAllowedAt);
    if (wait > 0) {
      set({
        error: {
          title: 'Email already sent',
          body: `Check your inbox and spam folder. You can send another in ${wait} ${wait === 1 ? 'second' : 'seconds'}.`,
          retryable: false,
        },
      });
      return false;
    }

    set({ busy: true, error: null, resetEmailAllowedAt: Date.now() + RESET_COOLDOWN_MS });
    try {
      await supabase.auth.resetPasswordForEmail(email.trim().toLowerCase(), {
        redirectTo: 'pawtrack://reset-password',
      });
    } catch (e) {
      console.warn('[auth] password reset failed', e);
    } finally {
      set({ busy: false });
    }
    return true;
  },

  /**
   * Sign out of THIS device only.
   *
   * Local data is deliberately left in place — see src/db/scope.ts. The caller
   * is responsible for warning about an undrained outbox first;
   * pendingWriteCount() below is what that warning reads.
   */
  signOut: async () => {
    const supabase = getSupabase();
    if (!supabase) return;
    set({ busy: true, error: null });
    try {
      const { error } = await supabase.auth.signOut({ scope: 'local' });
      if (error) throw new Error(error.message);
      applySession(null);
      set({ status: 'signed-out', session: null, user: null, pendingClaim: null });
    } catch (e) {
      set({
        error: {
          title: 'Could not sign out',
          body:
            'You are still signed in on this device. Your records are safe either way — try again in a moment.',
          retryable: true,
        },
      });
    } finally {
      set({ busy: false });
    }
  },

  clearPendingClaim: () => set({ pendingClaim: null }),
  setError: (message) => set({ error: message }),
}));

/* ------------------------------------------------------------------ */
/* Profile                                                             */
/* ------------------------------------------------------------------ */

type ProfileRow = {
  full_name: string;
  phone: string;
  emergency_contact_name: string;
  emergency_contact_phone: string;
};

async function writeProfile(profile: ProfileRow): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;
  const now = Date.now();
  const { error } = await supabase
    .from('profiles')
    .upsert({ ...profile, created_at: now, updated_at: now }, { onConflict: 'user_id' });
  if (error) console.warn('[auth] could not write profile', error.message);
}

/**
 * Move signup details from user_metadata into the profiles table.
 *
 * Runs on every sign-in and is a no-op once a row exists, so a user who
 * confirmed their email days later still gets their name recorded, and someone
 * who signed in with Apple or Google — where there was never a form — simply
 * has nothing to copy.
 */
async function reconcileProfile(user: User): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  try {
    const { data } = await supabase
      .from('profiles')
      .select('user_id')
      .limit(1)
      .maybeSingle();
    if (data) return;

    const meta = (user.user_metadata ?? {}) as Partial<ProfileRow> & {
      name?: string;
      full_name?: string;
    };
    // Apple and Google put a display name here under their own keys; fall back
    // through them so an OAuth account still gets a name rather than a blank.
    const fullName = (meta.full_name ?? meta.name ?? '').trim();
    if (!fullName) return;

    await writeProfile({
      full_name: fullName,
      phone: meta.phone ?? '',
      emergency_contact_name: meta.emergency_contact_name ?? '',
      emergency_contact_phone: meta.emergency_contact_phone ?? '',
    });
  } catch (e) {
    // A missing profile row is cosmetic. It must never block a sign-in.
    console.warn('[auth] profile reconcile failed', e);
  }
}

/**
 * How many local writes have not reached the account.
 *
 * Drives the sign-out warning: "3 records haven't been backed up yet."
 * Never block sign-out on it — just make sure the owner knows before they
 * potentially walk away from a phone holding the only copy.
 */
export async function pendingWriteCount(): Promise<number> {
  const db = await getDb();
  return outbox.pendingCount(db);
}

/** Whether to offer accounts at all in this build. */
export function accountsAvailable(): boolean {
  return isSyncConfigured();
}

/** Apple sign-in only exists on iOS; the button must not render elsewhere. */
export function appleSignInAvailable(): boolean {
  return Platform.OS === 'ios';
}
