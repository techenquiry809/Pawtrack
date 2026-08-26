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
  const meds = await db.getAllAsync<MedRow>(
    'SELECT * FROM medications WHERE dog_id = ? ORDER BY name COLLATE NOCASE ASC',
    [dogId],
  );
  if (meds.length === 0) return [];

  // One query for all reminders rather than one per medication — a dog on
  // four drugs should not cost five round trips to render a list.
  const reminders = await db.getAllAsync<ReminderRow>(
    `SELECT r.* FROM medication_reminders r
       JOIN medications m ON m.id = r.medication_id
      WHERE m.dog_id = ?
      ORDER BY r.time_hhmm ASC`,
    [dogId],
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
  const row = await db.getFirstAsync<MedRow>(
    'SELECT * FROM medications WHERE id = ?',
    [id],
  );
  if (!row) return null;
  const reminders = await db.getAllAsync<ReminderRow>(
    'SELECT * FROM medication_reminders WHERE medication_id = ? ORDER BY time_hhmm ASC',
    [id],
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
  await db.runAsync(
    `INSERT INTO medications
       (id, dog_id, name, dose, unit, frequency, scheduled_time, prescriber,
        created_at, updated_at)
     VALUES (?,?,?,?,?,?,'',?,?,?)`,
    [
      id, input.dogId, input.name.trim(), input.dose.trim(), input.unit.trim(),
      input.frequency.trim(), input.prescriber.trim(), now, now,
    ],
  );
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

  sets.push('updated_at = ?');
  values.push(Date.now(), id);

  const db = await getDb();
  await db.runAsync(`UPDATE medications SET ${sets.join(', ')} WHERE id = ?`, values);
}

/**
 * Reminders and dose history cascade automatically. Cancelling the scheduled
 * notifications is the CALLER's job — see medicationService — because this
 * layer must not know about the OS.
 */
export async function deleteMedication(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM medications WHERE id = ?', [id]);
}

/* ------------------------------------------------------------------ */
/* Reminders                                                           */
/* ------------------------------------------------------------------ */

export async function listAllReminders(
  dogId: string,
): Promise<MedicationReminder[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<ReminderRow>(
    `SELECT r.* FROM medication_reminders r
       JOIN medications m ON m.id = r.medication_id
      WHERE m.dog_id = ?
      ORDER BY r.time_hhmm ASC`,
    [dogId],
  );
  return rows.map(rowToReminder);
}

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
       FROM medication_reminders r
       JOIN medications m ON m.id = r.medication_id
       JOIN dogs d        ON d.id = m.dog_id
      WHERE r.enabled = 1
      ORDER BY r.time_hhmm ASC`,
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
  const existing = await db.getFirstAsync<{ id: string }>(
    'SELECT id FROM medication_reminders WHERE medication_id = ? AND time_hhmm = ?',
    [medicationId, timeHHMM],
  );
  if (existing) return null;

  await db.runAsync(
    `INSERT INTO medication_reminders
       (id, medication_id, time_hhmm, enabled, notification_id, created_at, updated_at)
     VALUES (?,?,?,1,NULL,?,?)`,
    [id, medicationId, timeHHMM, now, now],
  );
  return id;
}

export async function setReminderEnabled(
  reminderId: string,
  enabled: boolean,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE medication_reminders SET enabled = ?, updated_at = ? WHERE id = ?',
    [toSqlBool(enabled), Date.now(), reminderId],
  );
}

/** Stores the OS handle so this exact notification can be cancelled later. */
export async function setReminderNotificationId(
  reminderId: string,
  notificationId: string | null,
): Promise<void> {
  const db = await getDb();
  await db.runAsync(
    'UPDATE medication_reminders SET notification_id = ?, updated_at = ? WHERE id = ?',
    [notificationId, Date.now(), reminderId],
  );
}

export async function deleteReminder(reminderId: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM medication_reminders WHERE id = ?', [reminderId]);
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
  await db.runAsync(
    `INSERT INTO medication_doses
       (id, medication_id, dog_id, dose_date, scheduled_hhmm, status,
        recorded_at, note, created_at)
     VALUES (?,?,?,?,?,?,?,?,?)
     ON CONFLICT(medication_id, dose_date, scheduled_hhmm) DO UPDATE SET
       status      = excluded.status,
       recorded_at = excluded.recorded_at,
       note        = excluded.note`,
    [
      uid(), input.medicationId, input.dogId, doseDate, scheduledHHMM,
      input.status, now, input.note ?? '', now,
    ],
  );
}

export async function listDosesForDate(
  dogId: string,
  dayKey: string,
): Promise<MedicationDose[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DoseRow>(
    'SELECT * FROM medication_doses WHERE dog_id = ? AND dose_date = ?',
    [dogId, dayKey],
  );
  return rows.map(rowToDose);
}

/** Dose history joined with medication names, for the merged History view. */
export async function listRecentDoses(
  dogId: string,
  limit = 400,
): Promise<(MedicationDose & { medicationName: string })[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DoseRow & { med_name: string }>(
    `SELECT d.*, m.name AS med_name
       FROM medication_doses d
       JOIN medications m ON m.id = d.medication_id
      WHERE d.dog_id = ?
      ORDER BY d.recorded_at DESC
      LIMIT ?`,
    [dogId, limit],
  );
  return rows.map((r) => ({ ...rowToDose(r), medicationName: r.med_name }));
}
