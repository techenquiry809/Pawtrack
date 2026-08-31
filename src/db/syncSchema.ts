/**
 * What syncs, what does not, and in what order.
 *
 * ── WHY A MANIFEST AND NOT `SELECT *` ─────────────────────────────────
 *
 * The difference between a column that syncs and one that must not is a
 * judgement about the DATA, not about its type, and it cannot be inferred at
 * runtime. `videos.file_uri` and `videos.note` are both TEXT; one is a
 * clinical observation that belongs on every device and the other is a path
 * that is actively wrong anywhere but the phone that wrote it.
 *
 * So the list is explicit, and it lives in exactly one place. Push, pull,
 * tombstone cascade and the claim flow all read from here. Adding a column to
 * a table and forgetting to add it here means it does not sync, which is the
 * safe direction to fail in — the opposite default would leak a device-local
 * path to another phone silently.
 *
 * See docs/ARCHITECTURE.md and supabase/migrations/20260828000100_core_schema.sql,
 * which mirrors these column lists on the server.
 */

/**
 * SQLite has no boolean. These columns are 0/1 locally and real booleans in
 * Postgres, so the sync layer converts them in both directions. Every other
 * column passes through untouched — JSON columns included, which are TEXT on
 * both sides precisely so nothing reformats them in transit.
 */
export type SyncColumnType = 'passthrough' | 'bool';

export type SyncTableSpec = {
  /** Local SQLite table name. Identical on the server. */
  table: string;
  /**
   * Columns that cross the wire, in a stable order.
   *
   * `user_id` appears here because a PULL writes it, but it is stripped from
   * every PUSH: the server sets it from auth.uid() so a client cannot claim to
   * be writing on someone else's behalf. See PUSH_EXCLUDED_COLUMNS.
   */
  columns: Record<string, SyncColumnType>;
  /**
   * Columns that exist locally and deliberately never leave the device. Listed
   * rather than merely omitted, so the reason is recorded next to the decision
   * and a future reader does not "fix" the omission.
   */
  deviceLocal: Record<string, string>;
  /** Parent tables whose tombstone must cascade to this one. */
  parents: { table: string; localColumn: string }[];
};

const T = 'passthrough' as const;
const B = 'bool' as const;

/**
 * ORDERED BY FOREIGN-KEY DEPENDENCY.
 *
 * Push walks this array forwards so a parent always lands before its children.
 * Pull walks it forwards for the same reason — a video arriving before its
 * seizure would violate the FK and abort the page. Tombstone cascade walks it
 * forwards too, marking parents before children.
 */
export const SYNC_TABLES: SyncTableSpec[] = [
  {
    table: 'dogs',
    columns: {
      id: T, user_id: T, name: T, breed_id: T, breed_name: T, breed_source: T,
      breed_user_desc: T, sex: T, age_years: T, weight_kg: T, dob: T,
      diagnosis_status: T, first_seizure_date: T, seizure_type: T,
      allergies: T, diet: T, vet_json: T, emergency_vet_json: T,
      emergency_plan_json: T, created_at: T, updated_at: T, deleted_at: T,
    },
    deviceLocal: {
      photo_uri:
        'A path into this phone’s document directory. Meaningless on another ' +
        'device, and iOS reassigns the container UUID on reinstall anyway ' +
        '(see src/services/fileStore.ts).',
    },
    parents: [],
  },

  {
    table: 'seizures',
    columns: {
      id: T, user_id: T, dog_id: T, start: T, end: T, duration_sec: T,
      timing_confidence: T, retrospective: B, pre_ictal_obs: T,
      pre_ictal_note: T, ictal_obs: T, awareness: T, autonomic: T,
      position: T, post_behavior: T, severity_owner: T, recovery_start: T,
      recovery_end: T, recovery_sec: T, context_json: T, notes: T,
      time_since_prev_sec: T, status: T, duration_confidence: T,
      last_touched_at: T, tz_offset_min: T, created_at: T, updated_at: T,
      deleted_at: T,
    },
    deviceLocal: {},
    parents: [{ table: 'dogs', localColumn: 'dog_id' }],
  },

  {
    table: 'medications',
    columns: {
      id: T, user_id: T, dog_id: T, name: T, dose: T, unit: T, frequency: T,
      prescriber: T, created_at: T, updated_at: T, deleted_at: T,
    },
    deviceLocal: {
      scheduled_time:
        'Dead since migration 4 moved reminder times to their own table.',
      notification_id:
        'Dead since migration 4, AND device-local for the same reason as ' +
        'medication_reminders.notification_id below.',
    },
    parents: [{ table: 'dogs', localColumn: 'dog_id' }],
  },

  {
    table: 'daily_checkins',
    columns: {
      id: T, user_id: T, dog_id: T, timestamp: T, check_in_date: T,
      sleep_hrs: T, appetite: T, water: T, energy: T, stress: T,
      med_on_time: B, gi: T, unusual: T, backfilled: B, mood_only: B,
      created_at: T, updated_at: T, deleted_at: T,
    },
    deviceLocal: {},
    parents: [{ table: 'dogs', localColumn: 'dog_id' }],
  },

  {
    table: 'meals',
    columns: {
      id: T, user_id: T, dog_id: T, timestamp: T, description: T,
      is_new_food: B, created_at: T, updated_at: T, deleted_at: T,
    },
    deviceLocal: {},
    parents: [{ table: 'dogs', localColumn: 'dog_id' }],
  },

  {
    table: 'videos',
    columns: {
      id: T, user_id: T, dog_id: T, seizure_id: T, source: T, timestamp: T,
      imported_at: T, capture_confidence: T, duration_sec: T, note: T,
      pre_note: T, ictal_note: T, post_note: T,
      origin_device_id: T, created_at: T, updated_at: T, deleted_at: T,
    },
    deviceLocal: {
      file_uri:
        'THE BYTES NEVER LEAVE THE PHONE. The row is clinical data — "a ' +
        'recording exists for this seizure" matters to a vet on any device — ' +
        'so the row syncs and the path does not. Live in video_files instead.',
      thumb_uri: 'Same as file_uri. See src/db/videoRepo.ts.',
    },
    parents: [
      { table: 'seizures', localColumn: 'seizure_id' },
      { table: 'dogs', localColumn: 'dog_id' },
    ],
  },

  {
    table: 'seizure_edits',
    columns: {
      id: T, user_id: T, dog_id: T, seizure_id: T, edited_at: T, summary: T,
      updated_at: T, deleted_at: T,
    },
    deviceLocal: {},
    parents: [
      { table: 'seizures', localColumn: 'seizure_id' },
      { table: 'dogs', localColumn: 'dog_id' },
    ],
  },

  {
    table: 'medication_reminders',
    columns: {
      id: T, user_id: T, dog_id: T, medication_id: T, time_hhmm: T,
      enabled: B, created_at: T, updated_at: T, deleted_at: T,
    },
    deviceLocal: {
      notification_id:
        'A handle returned by expo-notifications on ONE device. Device B ' +
        'cannot cancel device A’s handle, so syncing it produces a reminder ' +
        'that cannot be turned off from the phone in your hand. Each device ' +
        'schedules and owns its own notification for a shared reminder row.',
    },
    parents: [
      { table: 'medications', localColumn: 'medication_id' },
      { table: 'dogs', localColumn: 'dog_id' },
    ],
  },

  {
    table: 'medication_doses',
    columns: {
      id: T, user_id: T, dog_id: T, medication_id: T, dose_date: T,
      scheduled_hhmm: T, status: T, recorded_at: T, note: T, created_at: T,
      updated_at: T, deleted_at: T,
    },
    deviceLocal: {},
    parents: [
      { table: 'medications', localColumn: 'medication_id' },
      { table: 'dogs', localColumn: 'dog_id' },
    ],
  },
];

export const SYNC_TABLE_NAMES: string[] = SYNC_TABLES.map((t) => t.table);

const BY_NAME = new Map(SYNC_TABLES.map((t) => [t.table, t]));

export function syncSpec(table: string): SyncTableSpec {
  const spec = BY_NAME.get(table);
  if (!spec) throw new Error(`[sync] '${table}' is not a synced table`);
  return spec;
}

/**
 * Set on the server, never accepted from a client.
 *
 * The server assigns user_id from auth.uid() inside sync_push. Sending it
 * would at best be ignored and at worst read as an attempt to write into
 * another account, which RLS rejects — failing the whole batch for no reason.
 */
export const PUSH_EXCLUDED_COLUMNS = new Set(['user_id']);

/**
 * Children that a tombstone must cascade to, keyed by parent table.
 *
 * ── WHY THIS EXISTS AND WHY IT IS EASY TO MISS ────────────────────────
 *
 * SQLite's ON DELETE CASCADE fires on a real DELETE. Every delete in this app
 * is now an UPDATE setting deleted_at, so the foreign key never fires at all.
 * Without an explicit walk, tombstoning a seizure leaves its videos and edit
 * rows live: they sync to another device as orphans pointing at a record that
 * device has already hidden.
 *
 * Derived from `parents` above so the two can never disagree.
 */
export const TOMBSTONE_CHILDREN: Record<
  string,
  { table: string; localColumn: string }[]
> = SYNC_TABLES.reduce(
  (acc, spec) => {
    for (const parent of spec.parents) {
      (acc[parent.table] ??= []).push({
        table: spec.table,
        localColumn: parent.localColumn,
      });
    }
    return acc;
  },
  {} as Record<string, { table: string; localColumn: string }[]>,
);

/**
 * Quotes an identifier for SQLite and Postgres alike.
 *
 * `end` is the reason this exists. It is a column on `seizures` and a RESERVED
 * word in Postgres (CASE … END), so an unquoted reference fails there outright.
 * `start`, `position` and `timestamp` are keywords in one dialect or the other
 * too. Quoting every generated identifier costs nothing and removes the whole
 * category.
 */
export function q(identifier: string): string {
  if (!/^[a-z_][a-z0-9_]*$/.test(identifier)) {
    throw new Error(`[sync] refusing suspicious identifier '${identifier}'`);
  }
  return `"${identifier}"`;
}

/** Column list for a SELECT against the local table, correctly quoted. */
export function selectList(spec: SyncTableSpec): string {
  return Object.keys(spec.columns).map(q).join(', ');
}
