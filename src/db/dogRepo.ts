/**
 * Dog repository. All dog + vet contact + emergency plan persistence.
 *
 * Note that vet contacts and the emergency plan are stored as JSON columns
 * rather than separate tables. They are strictly 1:1 with a dog, are always
 * read together with it, and are never queried across dogs — so normalising
 * them would add joins for no benefit.
 */

import { getDb, uid, toSqlJson, fromSqlObject } from './client';
import { newRowOwner, ownerScope } from './scope';
import { enqueue } from './outbox';
import { tombstone } from './tombstone';
import type {
  Breed,
  Dog,
  EmergencyPlan,
  VetContact,
} from '@/types/domain';

const EMPTY_CONTACT: VetContact = { name: '', clinic: '', phone: '' };
const EMPTY_PLAN: EmergencyPlan = {
  whenToCall: '', medName: '', doseRoute: '', maxDoses: '', special: '',
};

type DogRow = {
  id: string;
  name: string;
  photo_uri: string;
  breed_id: string | null;
  breed_name: string;
  breed_source: string;
  breed_user_desc: string;
  sex: string;
  age_years: number | null;
  weight_kg: number | null;
  dob: string;
  diagnosis_status: string;
  first_seizure_date: string;
  seizure_type: string;
  allergies: string;
  diet: string;
  vet_json: string;
  emergency_vet_json: string;
  emergency_plan_json: string;
  created_at: number;
  updated_at: number;
};

function rowToDog(row: DogRow): Dog {
  return {
    id: row.id,
    name: row.name,
    photoUri: row.photo_uri,
    breed: {
      breedId: row.breed_id,
      breedName: row.breed_name,
      breedSource: row.breed_source,
      userEnteredDescription: row.breed_user_desc,
    },
    sex: row.sex as Dog['sex'],
    ageYears: row.age_years,
    weightKg: row.weight_kg,
    dob: row.dob,
    diagnosisStatus: row.diagnosis_status as Dog['diagnosisStatus'],
    firstSeizureDate: row.first_seizure_date,
    seizureType: row.seizure_type,
    allergies: row.allergies,
    diet: row.diet,
    vet: fromSqlObject<VetContact>(row.vet_json, EMPTY_CONTACT),
    emergencyVet: fromSqlObject<VetContact>(row.emergency_vet_json, EMPTY_CONTACT),
    emergencyPlan: fromSqlObject<EmergencyPlan>(row.emergency_plan_json, EMPTY_PLAN),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Every read below goes through `dogs_live`, not `dogs`.
 *
 * The view bakes in `deleted_at IS NULL` so a tombstoned dog cannot come back
 * through a query someone forgot to filter. The owner fence has to be added
 * per query because it is parameterised — `ownerScope()` never returns an
 * empty string, so leaving it out is a syntax error rather than a silent leak
 * of another account's records.
 *
 * The sync layer is the one caller that reads the BASE table, because it is
 * the one caller that legitimately needs to see tombstones.
 */
export async function listDogs(): Promise<Dog[]> {
  const db = await getDb();
  const owner = ownerScope();
  const rows = await db.getAllAsync<DogRow>(
    `SELECT * FROM dogs_live WHERE ${owner.sql} ORDER BY created_at ASC`,
    owner.params,
  );
  return rows.map(rowToDog);
}

export async function getDog(id: string): Promise<Dog | null> {
  const db = await getDb();
  const owner = ownerScope();
  const row = await db.getFirstAsync<DogRow>(
    `SELECT * FROM dogs_live WHERE id = ? AND ${owner.sql}`,
    [id, ...owner.params],
  );
  return row ? rowToDog(row) : null;
}

export type NewDogInput = {
  name: string;
  breed?: Breed;
  ageYears?: number | null;
};

export async function createDog(input: NewDogInput): Promise<string> {
  const db = await getDb();
  const id = uid();
  const now = Date.now();
  const breed: Breed = input.breed ?? {
    breedId: null, breedName: '', breedSource: '', userEnteredDescription: '',
  };

  // The row write and its outbox entry share one transaction. If a crash
  // could land between them the row would exist on this phone with nothing
  // recording that it needs pushing — a dog that never reaches the account.
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `INSERT INTO dogs (
        id, user_id, name, breed_id, breed_name, breed_source, breed_user_desc,
        sex, age_years, weight_kg, dob, diagnosis_status,
        first_seizure_date, seizure_type, allergies, diet,
        vet_json, emergency_vet_json, emergency_plan_json,
        created_at, updated_at
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      [
        id, newRowOwner(), input.name, breed.breedId, breed.breedName,
        breed.breedSource, breed.userEnteredDescription, '',
        input.ageYears ?? null, null, '',
        'undiagnosed', '', '', '', '',
        toSqlJson(EMPTY_CONTACT), toSqlJson(EMPTY_CONTACT), toSqlJson(EMPTY_PLAN),
        now, now,
      ],
    );
    await enqueue(db, 'dogs', id, 'upsert', now);
  });
  return id;
}

export async function updateDog(
  id: string,
  patch: Partial<Omit<Dog, 'id' | 'createdAt'>>,
): Promise<void> {
  const db = await getDb();
  const sets: string[] = [];
  const values: (string | number | null)[] = [];

  const push = (column: string, value: string | number | null) => {
    sets.push(`${column} = ?`);
    values.push(value);
  };

  if (patch.name !== undefined) push('name', patch.name);
  if (patch.photoUri !== undefined) push('photo_uri', patch.photoUri);
  if (patch.breed !== undefined) {
    push('breed_id', patch.breed.breedId);
    push('breed_name', patch.breed.breedName);
    push('breed_source', patch.breed.breedSource);
    push('breed_user_desc', patch.breed.userEnteredDescription);
  }
  if (patch.sex !== undefined) push('sex', patch.sex);
  if (patch.ageYears !== undefined) push('age_years', patch.ageYears);
  if (patch.weightKg !== undefined) push('weight_kg', patch.weightKg);
  if (patch.dob !== undefined) push('dob', patch.dob);
  if (patch.diagnosisStatus !== undefined) push('diagnosis_status', patch.diagnosisStatus);
  if (patch.firstSeizureDate !== undefined) push('first_seizure_date', patch.firstSeizureDate);
  if (patch.seizureType !== undefined) push('seizure_type', patch.seizureType);
  if (patch.allergies !== undefined) push('allergies', patch.allergies);
  if (patch.diet !== undefined) push('diet', patch.diet);
  if (patch.vet !== undefined) push('vet_json', toSqlJson(patch.vet));
  if (patch.emergencyVet !== undefined) push('emergency_vet_json', toSqlJson(patch.emergencyVet));
  if (patch.emergencyPlan !== undefined) push('emergency_plan_json', toSqlJson(patch.emergencyPlan));

  if (sets.length === 0) return;

  const now = Date.now();
  push('updated_at', now);
  values.push(id);

  const owner = ownerScope();
  await db.withTransactionAsync(async () => {
    await db.runAsync(
      `UPDATE dogs SET ${sets.join(', ')}
        WHERE id = ? AND deleted_at IS NULL AND ${owner.sql}`,
      [...values, ...owner.params],
    );
    await enqueue(db, 'dogs', id, 'upsert', now);
  });
}

/**
 * Soft-deletes the dog and everything beneath them.
 *
 * ── WHAT CHANGED, AND WHY THE COMMENT ABOVE THIS USED TO BE WRONG ─────
 *
 * This was a hard DELETE that leaned on ON DELETE CASCADE to remove every
 * seizure, video row, medication and check-in. Foreign keys fire on a DELETE.
 * They do not fire on the UPDATE that a replicable delete has to be — so the
 * moment deletes went soft, that cascade silently stopped happening and would
 * have left an entire dog's history live but unreachable, then pushed it to
 * every other device as orphans.
 *
 * tombstone() walks the subtree explicitly instead, in one transaction, and
 * queues every row it marks. See src/db/tombstone.ts.
 *
 * Video FILES on disk are still the caller's job — this layer never touches
 * the filesystem. Note the asymmetry that is deliberate: the row deletion
 * syncs, the file deletion does not.
 */
export async function deleteDog(id: string): Promise<void> {
  await tombstone('dogs', id);
}

/** Display helper shared by Home, History and the vet report. */
export function breedDisplay(dog: Pick<Dog, 'breed'>): string {
  const b = dog.breed;
  if (!b.breedName) return 'Breed not set';
  if (b.breedName === 'Other' && b.userEnteredDescription) {
    return b.userEnteredDescription;
  }
  if (b.breedName === 'Mixed Breed' && b.userEnteredDescription) {
    return `Mixed Breed (${b.userEnteredDescription})`;
  }
  return b.breedName;
}
