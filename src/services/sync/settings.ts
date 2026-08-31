/**
 * Settings sync.
 *
 * Settings are one validated JSON blob locally (`app_state.settings`, parsed
 * by SettingsSchema), and they stay that shape on the server. Adding a setting
 * then never needs a server migration.
 *
 * ── WHAT IS DELIBERATELY NOT IN HERE ──────────────────────────────────
 *
 * The active-dog selection. That is a per-device UI preference, not a fact
 * about the dog: an iPad showing Lucy should not flip to Max because the phone
 * did. It stays in app_state and never leaves.
 */

import { getDb } from '@/db/client';
import { getSyncValue, setSyncValue } from '@/db/syncState';
import { getSupabase } from '@/services/supabase';
import { DEFAULT_SETTINGS, SettingsSchema } from '@/types/domain';

const SETTINGS_KEY = 'settings';
const UPDATED_AT_KEY = 'settings_updated_at';

async function readLocal(): Promise<{ json: string; updatedAt: number } | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<{ value: string }>(
    'SELECT value FROM app_state WHERE key = ?',
    [SETTINGS_KEY],
  );
  if (!row) return null;

  const raw = await getSyncValue(UPDATED_AT_KEY);
  const parsed = raw === null ? 0 : Number.parseInt(raw, 10);
  return { json: row.value, updatedAt: Number.isFinite(parsed) ? parsed : 0 };
}

/** Called by the settings store on every change, to stamp a comparable time. */
export async function markSettingsChanged(now = Date.now()): Promise<void> {
  await setSyncValue(UPDATED_AT_KEY, String(now));
}

export async function pushSettings(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const local = await readLocal();
  if (!local || local.updatedAt === 0) return;

  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user.id;
  if (!userId) return;

  const { error } = await supabase.from('user_settings').upsert(
    {
      user_id: userId,
      settings_json: local.json,
      updated_at: local.updatedAt,
    },
    { onConflict: 'user_id' },
  );

  if (error) console.warn('[sync] settings push failed', error.message);
}

export async function pullSettings(): Promise<void> {
  const supabase = getSupabase();
  if (!supabase) return;

  const { data, error } = await supabase
    .from('user_settings')
    .select('settings_json, updated_at')
    .limit(1)
    .maybeSingle();

  if (error || !data) return;

  const remoteUpdatedAt = Number(data.updated_at ?? 0);
  const local = await readLocal();

  // Last-write-wins, and a tie goes to what is already here — re-writing an
  // identical value would churn the store and re-render every screen watching
  // it for nothing.
  if (local && local.updatedAt >= remoteUpdatedAt) return;

  // Validate before storing. A bad write or a newer app version's extra keys
  // must not be able to put, say, a zero-minute emergency threshold into a
  // seizure app.
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(String(data.settings_json ?? '{}'));
  } catch {
    console.warn('[sync] settings from server were not valid JSON; ignoring');
    return;
  }

  const validated = SettingsSchema.safeParse({
    ...DEFAULT_SETTINGS,
    ...(typeof parsedJson === 'object' && parsedJson ? parsedJson : {}),
  });
  if (!validated.success) {
    console.warn('[sync] settings from server failed validation; ignoring');
    return;
  }

  const db = await getDb();
  await db.runAsync(
    `INSERT INTO app_state (key, value) VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [SETTINGS_KEY, JSON.stringify(validated.data)],
  );
  await setSyncValue(UPDATED_AT_KEY, String(remoteUpdatedAt));
}
