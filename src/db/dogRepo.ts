/**
 * Dog repository. All dog + vet contact + emergency plan persistence.
 *
 * Note that vet contacts and the emergency plan are stored as JSON columns
 * rather than separate tables. They are strictly 1:1 with a dog, are always
 * read together with it, and are never queried across dogs — so normalising
 * them would add joins for no benefit.
 */

import { getDb, uid, toSqlJson, fromSqlJson } from './client';
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
    vet: fromSqlJson<VetContact>(row.vet_json, EMPTY_CONTACT),
    emergencyVet: fromSqlJson<VetContact>(row.emergency_vet_json, EMPTY_CONTACT),
    emergencyPlan: fromSqlJson<EmergencyPlan>(row.emergency_plan_json, EMPTY_PLAN),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function listDogs(): Promise<Dog[]> {
  const db = await getDb();
  const rows = await db.getAllAsync<DogRow>(
    'SELECT * FROM dogs ORDER BY created_at ASC',
  );
  return rows.map(rowToDog);
}

export async function getDog(id: string): Promise<Dog | null> {
  const db = await getDb();
  const row = await db.getFirstAsync<DogRow>('SELECT * FROM dogs WHERE id = ?', [id]);
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

  await db.runAsync(
    `INSERT INTO dogs (
      id, name, breed_id, breed_name, breed_source, breed_user_desc,
      sex, age_years, weight_kg, dob, diagnosis_status,
      first_seizure_date, seizure_type, allergies, diet,
      vet_json, emergency_vet_json, emergency_plan_json,
      created_at, updated_at
    ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    [
      id, input.name, breed.breedId, breed.breedName, breed.breedSource,
      breed.userEnteredDescription, '', input.ageYears ?? null, null, '',
      'undiagnosed', '', '', '', '',
      toSqlJson(EMPTY_CONTACT), toSqlJson(EMPTY_CONTACT), toSqlJson(EMPTY_PLAN),
      now, now,
    ],
  );
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

  push('updated_at', Date.now());
  values.push(id);
  await db.runAsync(`UPDATE dogs SET ${sets.join(', ')} WHERE id = ?`, values);
}

/**
 * Deletes the dog and — via ON DELETE CASCADE — every seizure, video row,
 * medication and check-in belonging to them. Video FILES on disk must be
 * cleaned up separately by the caller.
 */
export async function deleteDog(id: string): Promise<void> {
  const db = await getDb();
  await db.runAsync('DELETE FROM dogs WHERE id = ?', [id]);
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
