/**
 * App-wide state: the dog list, which dog is active, and settings.
 *
 * WHY ZUSTAND (and not Redux or Context)?
 * The app has a small amount of genuinely global state (active dog, settings)
 * and a lot of screen-local state. Redux would be ceremony for no benefit;
 * plain Context re-renders every consumer on any change. Zustand gives us
 * selector-based subscriptions in ~1KB with no provider boilerplate.
 *
 * Server/DB data is NOT mirrored here wholesale. Screens query the
 * repositories directly for lists, so we never have two sources of truth for
 * seizure records. Only the small, always-needed values live in this store.
 */

import { create } from 'zustand';
import { getDb } from '@/db/client';
import * as dogRepo from '@/db/dogRepo';
import { DEFAULT_SETTINGS, SettingsSchema, type Dog, type Settings } from '@/types/domain';
import { markSettingsChanged } from '@/services/sync/settings';

const ACTIVE_DOG_KEY = 'activeDogId';
const SETTINGS_KEY = 'settings';

type AppState = {
  dogs: Dog[];
  activeDogId: string | null;
  settings: Settings;
  hydrated: boolean;
  /**
   * Whether the first sync since this account signed in has finished —
   * succeeded, failed, or found nothing.
   *
   * ── WHY THIS IS IN THE STORE AND NOT IN THE ROOT LAYOUT ───────────────
   *
   * Because two places have to agree about it, and while it was local state in
   * app/_layout.tsx only one of them could see it.
   *
   * An EMPTY dog list means two different things. On a phone that has finished
   * syncing it means "this account has no dog, ask for one". In the seconds
   * after signing in on a NEW device it means "the dog is still on its way" —
   * SQLite is empty because nothing has arrived yet, not because there is
   * nothing to arrive. The root gate was careful about that distinction and
   * held its redirect until the sync settled. app/(tabs)/_layout.tsx was not:
   * it redirected to onboarding on `dogs.length === 0` alone.
   *
   * So the gate would correctly send a second device to the tabs, the tab
   * layout would immediately bounce it to onboarding, and the owner was asked
   * to create the dog their account already had — one confirm away from a
   * duplicate. It also tore the whole tab tree down and back up on the way,
   * remounting every screen in it.
   *
   * Reset by `resetForAccountChange`, because it is a statement about the
   * account that is signed in now.
   */
  initialSyncSettled: boolean;

  hydrate: () => Promise<void>;
  setInitialSyncSettled: (settled: boolean) => void;
  refreshDogs: () => Promise<void>;
  /**
   * Re-read everything for a DIFFERENT owner, after the session changed.
   *
   * ── WHY CLEARING FIRST IS THE POINT ───────────────────────────────────
   *
   * This store caches `dogs` and `activeDogId` in memory, and nothing used to
   * re-read them when the account changed. Repository reads are fenced by
   * ownerScope(), but a fence on the QUERY does nothing for rows already
   * sitting in the store: sign out of A and into B on the same phone and the
   * Home screen kept rendering A's dog — name, breed, photo — until some
   * unrelated screen happened to call refreshDogs(). The route gate read the
   * same stale `dogs.length`, so a brand-new account skipped onboarding and
   * landed on Home showing the previous person's dog.
   *
   * So the cached values are dropped SYNCHRONOUSLY first and re-read after.
   * A frame of "no dog" is the correct thing to show while we find out; a
   * frame of someone else's dog is not.
   */
  resetForAccountChange: () => Promise<void>;
  setActiveDog: (dogId: string) => Promise<void>;
  updateSettings: (patch: Partial<Settings>) => Promise<void>;
};

async function readAppState(key: string): Promise<string | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_state WHERE key = ?',
    [key],
  );
  return row?.value ?? null;
}

async function writeAppState(key: string, value: string): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'INSERT INTO app_state (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value',
    [key, value],
  );
}

export const useAppStore = create<AppState>((set, get) => ({
  dogs: [],
  activeDogId: null,
  settings: DEFAULT_SETTINGS,
  hydrated: false,
  initialSyncSettled: false,

  setInitialSyncSettled: (settled) => set({ initialSyncSettled: settled }),

  hydrate: async () => {
    const dogs = await dogRepo.listDogs();
    const storedActive = await readAppState(ACTIVE_DOG_KEY);
    const rawSettings = await readAppState(SETTINGS_KEY);

    // Validate settings at runtime. If a bad write or a failed migration left
    // garbage here, fall back to safe defaults rather than running the app
    // with, say, a zero-minute emergency threshold.
    let settings = DEFAULT_SETTINGS;
    if (rawSettings) {
      const parsed = SettingsSchema.safeParse(JSON.parse(rawSettings));
      if (parsed.success) settings = parsed.data;
      else console.warn('[settings] stored value invalid, using defaults');
    }

    const activeDogId =
      storedActive && dogs.some((d) => d.id === storedActive)
        ? storedActive
        : (dogs[0]?.id ?? null);

    set({ dogs, activeDogId, settings, hydrated: true });
  },

  resetForAccountChange: async () => {
    // `initialSyncSettled` goes with them: it describes the account that just
    // left, and leaving it up would let the incoming one be judged "has no
    // dog" against a sync that ran for somebody else.
    set({ dogs: [], activeDogId: null, hydrated: false, initialSyncSettled: false });
    await get().hydrate();
  },

  refreshDogs: async () => {
    const dogs = await dogRepo.listDogs();
    const { activeDogId } = get();
    set({
      dogs,
      activeDogId:
        activeDogId && dogs.some((d) => d.id === activeDogId)
          ? activeDogId
          : (dogs[0]?.id ?? null),
    });
  },

  setActiveDog: async (dogId) => {
    await writeAppState(ACTIVE_DOG_KEY, dogId);
    set({ activeDogId: dogId });
  },

  updateSettings: async (patch) => {
    const next = { ...get().settings, ...patch };
    const parsed = SettingsSchema.safeParse(next);
    if (!parsed.success) {
      console.warn('[settings] rejected invalid update', parsed.error.message);
      return;
    }
    await writeAppState(SETTINGS_KEY, JSON.stringify(parsed.data));
    // Stamp a comparable time so settings sync has something to run
    // last-write-wins against. app_state has no timestamp column of its own,
    // and without this an edit made on one phone would never beat the copy
    // already on the server.
    await markSettingsChanged();
    set({ settings: parsed.data });
  },
}));

/** Convenience selector used by nearly every screen. */
export function useActiveDog(): Dog | null {
  return useAppStore(
    (s) => s.dogs.find((d) => d.id === s.activeDogId) ?? s.dogs[0] ?? null,
  );
}
