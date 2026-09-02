/**
 * Medication repository — medications, their reminder times, and the dose log.
 *
 * Three tables, one module, because they are never useful apart: a medication
 * without its reminders cannot be rendered, and a dose without its medication
 * has no name to show.
 *
 * SAFETY: nothing in this file computes, suggests or defaults a dose. Every
 * amount is a string the owner typed from their vet's instructions. A dose
 * status is likewise always owner-reported — the app never infers "missed"
 * from silence, because not opening an app is not evidence about a dog.
 */

import { getDb, uid, toSqlBool, fromSqlBool } from './client';
import { newRowOwner, ownerScope } from './scope';
import { enqueue } from './outbox';
import { tombstone } from './tombstone';
import { localDayKey } from '@/utils/time';
import {
  MedicationDoseSchema,
  MedicationReminderSchema,
  MedicationSchema,
  type DoseStatus,
  type Medication,
  type MedicationDose,
  type MedicationReminder,
  type MedicationWithReminders,
} from '@/types/domain';

/* ------------------------------------------------------------------ */
/* Row mapping                                                         */
/* ------------------------------------------------------------------ */

type MedRow = {
  id: string;
  dog_id: string;
  name: string;
  dose: string;
  unit: string;
  frequency: string;
  prescriber: string;
  created_at: number;
  updated_at: number;
};

const rowToMed = (r: MedRow): Medication => ({
  id: r.id,
  dogId: r.dog_id,
  name: r.name,
  dose: r.dose,
  unit: r.unit,
  frequency: r.frequency,
  prescriber: r.prescriber,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

type ReminderRow = {
  id: string;
  medication_id: string;
  time_hhmm: string;
  enabled: number;
  notification_id: string | null;
  created_at: number;
  updated_at: number;
};

const rowToReminder = (r: ReminderRow): MedicationReminder => ({
  id: r.id,
  medicationId: r.medication_id,
  timeHHMM: r.time_hhmm,
  enabled: fromSqlBool(r.enabled),
  notificationId: r.notification_id,
  createdAt: r.created_at,
  updatedAt: r.updated_at,
});

type DoseRow = {
  id: string;
  medication_id: string;
  dog_id: string;
  dose_date: string;
  scheduled_hhmm: string;
  status: string;
  recorded_at: number;
  note: string;
  created_at: number;
};

const rowToDose = (r: DoseRow): MedicationDose => ({
  id: r.id,
  medicationId: r.medication_id,
  dogId: r.dog_id,
  doseDate: r.dose_date,
  scheduledHHMM: r.scheduled_hhmm,
  status: r.status as DoseStatus,
  recordedAt: r.recorded_at,
  note: r.note,
  createdAt: r.created_at,
});

/* ------------------------------------------------------------------ */
/* Medications                                                         */
/* ------------------------------------------------------------------ */

/** Every medication for a dog, each with its reminder times attached. */
export async function listMedications(
  dogId: string,
): Promise<MedicationWithReminders[]> {
  const db = await getDb();
  const owner = ownerScope();
  const meds = await db.getAllAsync<MedRow>(
    `SELECT * FROM medications_live
      WHERE dog_id = ? AND ${owner.sql} ORDER BY name COLLATE NOCASE ASC`,
    [dogId, ...owner.params],
  );
  if (meds.length === 0) return [];

  // One query for all reminders rather than one per medication — a dog on
  // four drugs should not cost five round trips to render a list.
  const reminders = await db.getAllAsync<ReminderRow>(
    `SELECT r.* FROM medication_reminders_live r
       JOIN medications_live m ON m.id = r.medication_id
      WHERE m.dog_id = ? AND ${ownerScope('r').sql}
      ORDER BY r.time_hhmm ASC`,
    [dogId, ...ownerScope('r').params],
  );

  const byMed = new Map<string, MedicationReminder[]>();
  for (const row of reminders) {
    const list = byMed.get(row.medication_id);
    if (list) list.push(rowToReminder(row));
    else byMed.set(row.medication_id, [rowToReminder(row)]);
  }

  return meds.map((m) => ({
    ...rowToMed(m),
    reminders: byMed.get(m.id) ?? [],
  }));
}

export async function getMedication(
  id: string,
): Promise<MedicationWithReminders | null> {
  const db = await getDb();
  const owner = ownerScope();
  const row = await db.getFirstAsync<MedRow>(
    `SELECT * FROM medications_live WHERE id = ? AND ${owner.sql}`,
    [id, ...owner.params],
  );
  if (!row) return null;
  const reminders = await db.getAllAsync<ReminderRow>(
    `SELECT * FROM medication_reminders_live
      WHERE medication_id = ? AND ${owner.sql} ORDER BY time_hhmm ASC`,
    [id, ...owner.params],
  );
  return { ...rowToMed(row), reminders: reminders.map(rowToReminder) };
}

export type NewMedicationInput = Omit<
  Medication,
  'id' | 'createdAt' | 'updatedAt'
>;

export async function createMedication(
  input: NewMedicationInput,
): Promise<string> {
  const now = Date.now();
  const id = uid();
  // Validate at the storage boundary — a blank name would render as an
  // unnameable reminder on a lock screen.
  MedicationSchema.parse({ ...input, id, createdAt: now, updatedAt: now });

  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO medications
         (id, user_id, dog_id, name, dose, unit, frequency, scheduled_time,
          prescriber, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,'',?,?,?)`,
      [
        id, newRowOwner(), input.dogId, input.name.trim(), input.dose.trim(),
        input.unit.trim(), input.frequency.trim(), input.prescriber.trim(),
        now, now,
      ],
    );
    await enqueue(db, 'medications', id, 'upsert', now);
  });
  return id;
}

export async function updateMedication(
  id: string,
  patch: Partial<NewMedicationInput>,
): Promise<void> {
  const columns: Record<string, string> = {
    name: 'name', dose: 'dose', unit: 'unit',
    frequency: 'frequency', prescriber: 'prescriber',
  };

  const sets: string[] = [];
  const values: (string | number)[] = [];
  for (const [key, value] of Object.entries(patch)) {
    const column = columns[key];
    if (!column || typeof value !== 'string') continue;
    sets.push(`${column} = ?`);
    values.push(value.trim());
  }
  if (sets.length === 0) return;

  const now = Date.now();
  sets.push('updated_at = ?');
  values.push(now, id);

  const db = await getDb();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE medications SET ${sets.join(', ')} WHERE id = ? AND deleted_at IS NULL`,
      values,
    );
    await enqueue(db, 'medications', id, 'upsert', now);
  });
}

/**
 * Soft-deletes the medication, its reminders and its dose history.
 *
 * The cascade is explicit now. It used to say "reminders and dose history
 * cascade automatically" — true of the DELETE this replaces, and false of a
 * tombstone: SQLite's ON DELETE CASCADE does not fire on an UPDATE that sets
 * deleted_at. Left implicit, stopping a drug would have left its reminders
 * live on every other device, which for an anticonvulsant means alarms for a
 * dose the dog is no longer prescribed.
 *
 * Cancelling the scheduled notifications is still the CALLER's job — see
 * medicationReminders — because this layer must not know about the OS. Note
 * that each device cancels its OWN notifications: the handles are device-local
 * and one phone cannot cancel another's.
 */
export async function deleteMedication(id: string): Promise<void> {
  await tombstone('medications', id);
}

/* ------------------------------------------------------------------ */
/* Reminders                                                           */
/* ------------------------------------------------------------------ */

/** Every enabled reminder across all dogs — what rescheduling iterates. */
export async function listEnabledReminders(): Promise<
  (MedicationReminder & { medicationName: string; dogName: string; dose: string; unit: string })[]
> {
  const db = await getDb();
  const rows = await db.getAllAsync<
    ReminderRow & { med_name: string; dog_name: string; dose: string; unit: string }
  >(
    `SELECT r.*, m.name AS med_name, m.dose AS dose, m.unit AS unit,
            d.name AS dog_name
       FROM medication_reminders_live r
       JOIN medications_live m ON m.id = r.medication_id
       JOIN dogs_live d        ON d.id = m.dog_id
      WHERE r.enabled = 1 AND ${ownerScope('r').sql}
      ORDER BY r.time_hhmm ASC`,
    ownerScope('r').params,
  );
  return rows.map((r) => ({
    ...rowToReminder(r),
    medicationName: r.med_name,
    dogName: r.dog_name,
    dose: r.dose,
    unit: r.unit,
  }));
}

/**
 * Adds a reminder time. Returns null if that time already exists on this
 * medication — a duplicate is always a mis-tap, and the unique index would
 * throw, which is not worth surfacing as an error to the owner.
 */
export async function addReminder(
  medicationId: string,
  timeHHMM: string,
): Promise<string | null> {
  const now = Date.now();
  const id = uid();
  MedicationReminderSchema.parse({
    id, medicationId, timeHHMM, enabled: true,
    notificationId: null, createdAt: now, updatedAt: now,
  });

  const db = await getDb();
  // Owner-scoped like every other read in this file. Not reachable as a bug —
  // `medicationId` is a UUID from the caller's own list, so a cross-account
  // collision cannot occur — but an unfenced read is the wrong thing to leave
  // as the template the next query gets copied from.
  const owner = ownerScope();
  const existing = await db.getFirstAsync<{ id: string }>(
    `SELECT id FROM medication_reminders_live
      WHERE medication_id = ? AND time_hhmm = ? AND ${owner.sql}`,
    [medicationId, timeHHMM, ...owner.params],
  );
  if (existing) return null;

  // dog_id is denormalised onto reminders now, so it is resolved at write time
  // rather than joined at read time — the tombstone cascade and the server's
  // row policy both need to reach this row without going through medications.
  const parent = await db.getFirstAsync<{ dog_id: string; user_id: string | null }>(
    'SELECT dog_id, user_id FROM medications WHERE id = ?',
    [medicationId],
  );

  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO medication_reminders
         (id, user_id, dog_id, medication_id, time_hhmm, enabled,
          notification_id, created_at, updated_at)
       VALUES (?,?,?,?,?,1,NULL,?,?)`,
      [
        id, parent?.user_id ?? newRowOwner(), parent?.dog_id ?? null,
        medicationId, timeHHMM, now, now,
      ],
    );
    await enqueue(db, 'medication_reminders', id, 'upsert', now);
  });
  return id;
}

export async function setReminderEnabled(
  reminderId: string,
  enabled: boolean,
): Promise<void> {
  const db = await getDb();
  const now = Date.now();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE medication_reminders SET enabled = ?, updated_at = ?
        WHERE id = ? AND deleted_at IS NULL`,
      [toSqlBool(enabled), now, reminderId],
    );
    await enqueue(db, 'medication_reminders', reminderId, 'upsert', now);
  });
}

/**
 * Stores the OS handle so this exact notification can be cancelled later.
 *
 * ── THE ONE WRITE IN THIS FILE THAT DELIBERATELY DOES NOT ENQUEUE ─────
 *
 * `notification_id` is a handle returned by expo-notifications on THIS device.
 * Device B cannot cancel device A's handle. If this column synced, an owner
 * would end up with a medication reminder they could not turn off from the
 * phone in their hand — the alarm fires from a schedule owned by a device that
 * may be in a drawer.
 *
 * So each device schedules and owns its own notification for a shared reminder
 * row: `enabled` and `time_hhmm` sync, the handle does not. This function also
 * leaves `updated_at` alone, because bumping it would make a purely local
 * bookkeeping write look like a clinical edit and win a conflict against a
 * real one from another phone.
 */
export async function setReminderNotificationId(
  reminderId: string,
  notificationId: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE medication_reminders SET notification_id = ? WHERE id = ?',
    [notificationId, reminderId],
  );
}

export async function deleteReminder(reminderId: string): Promise<void> {
  await tombstone('medication_reminders', reminderId);
}

/* ------------------------------------------------------------------ */
/* Dose log                                                            */
/* ------------------------------------------------------------------ */

/**
 * Records what happened for one dose slot. Re-recording the same slot updates
 * it — an owner correcting "missed" to "given late" is a correction, not a
 * second dose.
 */
export async function recordDose(input: {
  medicationId: string;
  dogId: string;
  status: DoseStatus;
  scheduledHHMM?: string;
  doseDate?: string;
  note?: string;
}): Promise<void> {
  const now = Date.now();
  const doseDate = input.doseDate ?? localDayKey(now);
  const scheduledHHMM = input.scheduledHHMM ?? '';

  MedicationDoseSchema.parse({
    id: uid(),
    medicationId: input.medicationId,
    dogId: input.dogId,
    doseDate,
    scheduledHHMM,
    status: input.status,
    recordedAt: now,
    note: input.note ?? '',
    createdAt: now,
  });

  const db = await getDb();

  // RETURNING id for the same reason as the check-in upsert: this mints a
  // fresh uid() but usually UPDATES a row that already has one, and queueing
  // the generated id would push a row that does not exist. Two phones logging
  // the same dose slot is ONE dose — the unique index is the constraint, and
  // the database tells us which row it resolved onto.
  await db.withTransactionAsync(async () => {
    const written = await db.getFirstAsync<{ id: string }>(
      `INSERT INTO medication_doses
         (id, user_id, medication_id, dog_id, dose_date, scheduled_hhmm, status,
          recorded_at, note, created_at, updated_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)
       ON CONFLICT(medication_id, dose_date, scheduled_hhmm) DO UPDATE SET
         status      = excluded.status,
         recorded_at = excluded.recorded_at,
         note        = excluded.note,
         updated_at  = excluded.updated_at,
         deleted_at  = NULL
       RETURNING id`,
      [
        uid(), newRowOwner(), input.medicationId, input.dogId, doseDate,
        scheduledHHMM, input.status, now, input.note ?? '', now, now,
      ],
    );
    if (written) await enqueue(db, 'medication_doses', written.id, 'upsert', now);
  });
}

export async function listDosesForDate(
  dogId: string,
  dayKey: string,
): Promise<MedicationDose[]> {
  const db = await getDb();
  const owner = ownerScope();
  const rows = await db.getAllAsync<DoseRow>(
    `SELECT * FROM medication_doses_live
      WHERE dog_id = ? AND dose_date = ? AND ${owner.sql}`,
    [dogId, dayKey, ...owner.params],
  );
  return rows.map(rowToDose);
}

/**
 * Doses across an inclusive span of day keys, with the medication name joined.
 *
 * Inclusive at both ends because a day key IS the bucket — there is no midnight
 * to fall on the wrong side of, unlike the epoch-range seizure query.
 *
 * The name has to come from the join: a dose row stores only `medication_id`,
 * and a report printing an id instead of "Keppra" would be useless to the vet
 * it is written for.
 *
 * LEFT JOIN, unlike `listRecentDoses` above, and the difference matters here.
 * That function feeds a browsable history where a dose whose medication was
 * deleted is merely a curiosity. This one feeds a clinical record: the dose was
 * really given, and dropping it because the drug was later removed from the
 * list would silently understate adherence on the exact report a vet uses to
 * judge whether the treatment is being followed.
 */
export async function listDosesBetween(
  dogId: string,
  fromKey: string,
  toKey: string,
): Promise<(MedicationDose & { medicationName: string | null })[]> {
  const db = await getDb();
  const owner = ownerScope('d');
  const rows = await db.getAllAsync<DoseRow & { med_name: string | null }>(
    `SELECT d.*, m.name AS med_name
       FROM medication_doses_live d
       LEFT JOIN medications_live m ON m.id = d.medication_id
      WHERE d.dog_id = ? AND d.dose_date >= ? AND d.dose_date <= ? AND ${owner.sql}
      ORDER BY d.dose_date ASC, d.scheduled_hhmm ASC`,
    [dogId, fromKey, toKey, ...owner.params],
  );
  return rows.map((r) => ({ ...rowToDose(r), medicationName: r.med_name }));
}

/** Dose history joined with medication names, for the merged History view. */
export async function listRecentDoses(
  dogId: string,
  limit = 400,
): Promise<(MedicationDose & { medicationName: string })[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DoseRow & { med_name: string }>(
    `SELECT d.*, m.name AS med_name
       FROM medication_doses_live d
       JOIN medications_live m ON m.id = d.medication_id
      WHERE d.dog_id = ? AND ${ownerScope('d').sql}
      ORDER BY d.recorded_at DESC
      LIMIT ?`,
    [dogId, ...ownerScope('d').params, limit],
  );
  return rows.map((r) => ({ ...rowToDose(r), medicationName: r.med_name }));
}
