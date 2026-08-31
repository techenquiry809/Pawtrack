/**
 * The Supabase client.
 *
 * ── WHAT THIS IS AND IS NOT ───────────────────────────────────────────
 *
 * A sync target and an identity provider. It is NOT a database the app reads
 * from. Every screen still reads local SQLite exactly as it did before, and
 * nothing in app/ knows a network exists.
 *
 * That is not a stylistic preference. A seizure gets recorded in a field with
 * no signal, and the durability design — the row inserted on the first tap,
 * the monotonic clock, the crash salvage — depends on a local write that
 * cannot fail. Putting a cloud round trip anywhere in that path would undo it.
 */

// Must come before the supabase-js import: its fetch/auth paths construct URL
// objects, and React Native's built-in URL is incomplete.
import 'react-native-url-polyfill/auto';

import { AppState, Platform } from 'react-native';
import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

type PawtrackExtra = {
  supabaseUrl?: string;
  supabaseAnonKey?: string;
  googleWebClientId?: string;
  googleIosClientId?: string;
};

const extra = (Constants.expoConfig?.extra ?? {}) as PawtrackExtra;

export const SUPABASE_URL = extra.supabaseUrl ?? '';
export const SUPABASE_ANON_KEY = extra.supabaseAnonKey ?? '';
export const GOOGLE_WEB_CLIENT_ID = extra.googleWebClientId ?? '';
export const GOOGLE_IOS_CLIENT_ID = extra.googleIosClientId ?? '';

/**
 * Whether accounts are usable in this build.
 *
 * A build with no Supabase config is a perfectly valid build — it is the app
 * exactly as it shipped before sync existed. The auth screens hide themselves
 * rather than presenting a sign-in button that cannot work, and every sync
 * entry point becomes a no-op. Nothing else changes, because nothing else
 * depends on the network.
 */
export const isSyncConfigured = (): boolean =>
  SUPABASE_URL.length > 0 && SUPABASE_ANON_KEY.length > 0;

/* ------------------------------------------------------------------ */
/* Session storage                                                     */
/* ------------------------------------------------------------------ */
/**
 * Sessions live in expo-secure-store — the iOS keychain and the Android
 * keystore — never in AsyncStorage. These are bearer tokens for veterinary
 * health records, and AsyncStorage is an unencrypted file on disk that any
 * process with filesystem access on a rooted or jailbroken device can read.
 *
 * ── THE ANDROID SIZE LIMIT ────────────────────────────────────────────
 *
 * SecureStore caps a single value at 2048 bytes on Android. A Supabase session
 * is a JSON blob containing an access JWT, a refresh token and a user object;
 * with a few OAuth claims on it, it goes past 2048 routinely.
 *
 * The failure is nasty because it is silent and one-sided: the write throws or
 * truncates, the session never persists, and the user is signed out every time
 * they reopen the app — on Android only, so it survives every hour of testing
 * on a simulator. Hence chunking.
 *
 * Chunks are stored as `key.0`, `key.1`, … with a small manifest at `key`
 * recording how many there are. Reads that find a plain value fall through to
 * returning it directly, so a session written by an older build still loads.
 */
const CHUNK_SIZE = 1800; // headroom under 2048 for the key and encoding overhead
const MANIFEST_PREFIX = '__chunks__:';

async function deleteChunks(key: string, count: number): Promise<void> {
  for (let i = 0; i < count; i += 1) {
    await SecureStore.deleteItemAsync(`${key}.${i}`);
  }
}

async function readChunkCount(key: string): Promise<number | null> {
  const head = await SecureStore.getItemAsync(key);
  if (head === null) return null;
  if (!head.startsWith(MANIFEST_PREFIX)) return null;
  const parsed = Number.parseInt(head.slice(MANIFEST_PREFIX.length), 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export const SecureStoreAdapter = {
  getItem: async (key: string): Promise<string | null> => {
    try {
      const head = await SecureStore.getItemAsync(key);
      if (head === null) return null;

      // Not chunked — either a short value, or one written before chunking.
      if (!head.startsWith(MANIFEST_PREFIX)) return head;

      const count = Number.parseInt(head.slice(MANIFEST_PREFIX.length), 10);
      if (!Number.isFinite(count) || count <= 0) return null;

      const parts: string[] = [];
      for (let i = 0; i < count; i += 1) {
        const part = await SecureStore.getItemAsync(`${key}.${i}`);
        // A missing chunk means a partially-written session. Returning the
        // fragments joined would hand supabase-js malformed JSON; returning
        // null makes it treat the user as signed out, which is recoverable.
        if (part === null) return null;
        parts.push(part);
      }
      return parts.join('');
    } catch (error) {
      console.warn('[auth] could not read session from secure storage', error);
      return null;
    }
  },

  setItem: async (key: string, value: string): Promise<void> => {
    try {
      // Clear any previous chunks first, or shrinking from 3 chunks to 2
      // leaves `key.2` behind to be concatenated onto the next long value.
      const previous = await readChunkCount(key);
      if (previous !== null) await deleteChunks(key, previous);

      if (value.length <= CHUNK_SIZE) {
        await SecureStore.setItemAsync(key, value);
        return;
      }

      const count = Math.ceil(value.length / CHUNK_SIZE);
      for (let i = 0; i < count; i += 1) {
        await SecureStore.setItemAsync(
          `${key}.${i}`,
          value.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE),
        );
      }
      // Manifest last: until it lands, a torn write reads as "no session"
      // rather than as a truncated one.
      await SecureStore.setItemAsync(key, `${MANIFEST_PREFIX}${count}`);
    } catch (error) {
      console.warn('[auth] could not persist session to secure storage', error);
    }
  },

  removeItem: async (key: string): Promise<void> => {
    try {
      const previous = await readChunkCount(key);
      if (previous !== null) await deleteChunks(key, previous);
      await SecureStore.deleteItemAsync(key);
    } catch (error) {
      console.warn('[auth] could not clear session from secure storage', error);
    }
  },
};

/* ------------------------------------------------------------------ */
/* The client                                                          */
/* ------------------------------------------------------------------ */

let client: SupabaseClient | null = null;

/**
 * Returns the shared client, or null when this build has no Supabase config.
 *
 * Null rather than throwing: a build without accounts must run, and every
 * caller in src/services/sync/ already treats "no client" as "nothing to do".
 */
export function getSupabase(): SupabaseClient | null {
  if (!isSyncConfigured()) return null;
  if (client) return client;

  client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    auth: {
      storage: SecureStoreAdapter,
      persistSession: true,
      autoRefreshToken: true,
      // There is no browser redirect in the native id-token flow, and leaving
      // this on makes supabase-js look for a session in a URL that will never
      // contain one.
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
    global: {
      headers: { 'x-pawtrack-platform': Platform.OS },
    },
  });

  return client;
}

/**
 * Token refresh must not run while the app is backgrounded.
 *
 * supabase-js refreshes on a timer. On a suspended React Native app that timer
 * fires late and unpredictably, and a refresh attempt that races the app
 * coming back can burn the refresh token — rotation means a token can only be
 * spent once. Pausing while backgrounded and resuming on foreground is the
 * supported pattern.
 */
export function startAuthAutoRefresh(): () => void {
  const supabase = getSupabase();
  if (!supabase) return () => {};

  if (AppState.currentState === 'active') supabase.auth.startAutoRefresh();

  const subscription = AppState.addEventListener('change', (state) => {
    if (state === 'active') supabase.auth.startAutoRefresh();
    else supabase.auth.stopAutoRefresh();
  });

  return () => {
    subscription.remove();
    supabase.auth.stopAutoRefresh();
  };
}

/** Test seam — forces the next getSupabase() to rebuild. */
export function resetSupabaseClient(): void {
  client = null;
}
