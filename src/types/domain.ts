/**
 * Domain model for Paws Journal.
 *
 * Two things live here together on purpose:
 *   1. TypeScript types  — compile-time safety while we write code.
 *   2. Zod schemas       — RUNTIME validation when data comes back out of
 *                          SQLite or an imported backup.
 *
 * Why runtime validation for a local-only app? Because this is health data
 * that a veterinarian may make decisions from. If a migration goes wrong or a
 * backup file is corrupted, we want a loud, catchable error — not a silently
 * wrong seizure duration on a vet report.
 */

import { z } from 'zod';

/* ------------------------------------------------------------------ */
/* Structured observation vocabularies                                 */
/* ------------------------------------------------------------------ */
/**
 * These are `as const` arrays so they serve double duty: the UI maps over them
 * to render chips, and TypeScript derives a union type from the same source.
 * Add an option in one place and both the UI and the type update.
 *
 * Do not reword existing strings casually — they are stored verbatim in the
 * database, so renaming one orphans historical records.
 */
export const MOVEMENT_OPTIONS = [
  'Stiffening', 'Paddling', 'Jerking', 'Trembling', 'Muscle twitching',
  'Head/neck extension', 'Facial movements', 'Chewing/chomping',
  'Repetitive movements',
] as const;

export const AWARENESS_OPTIONS = [
  'Appears unconscious', 'Partially aware', 'Staring',
  'Responsive to voice', 'Unknown',
] as const;

export const AUTONOMIC_OPTIONS = [
  'Drooling/salivation', 'Urinated', 'Defecated', 'Vomited',
  'Changed breathing', 'Vocalized',
] as const;

export const POSITION_OPTIONS = [
  'Standing', 'Sitting', 'Lying on side', 'Fell over', 'Other',
] as const;

export const PRE_ICTAL_OPTIONS = [
  'Restlessness', 'Anxiety', 'Hiding', 'Seeking owner', 'Whining',
  'Trembling', 'Excessive salivation', 'Staring', 'Odd behavior',
  'Vocalization', 'Pacing', 'Other',
] as const;

export const POST_BEHAVIOR_OPTIONS = [
  'Normal', 'Confused', 'Disoriented', 'Very sleepy', 'Restless', 'Pacing',
  'Anxious', 'Weak/unsteady', 'Bumping into things', 'Excessively thirsty',
  'Excessively hungry', 'Unusually reactive', 'Unable to stand', 'Other',
] as const;

/**
 * Deliberately labelled "owner-observed". This is NOT a clinical grading and
 * the UI must always say so. See docs/ARCHITECTURE.md → Safety Rules.
 */
export const SEVERITY_OPTIONS = [
  'Mild-looking', 'Moderate-looking', 'Severe-looking', 'Unsure',
] as const;

export type MovementObservation = (typeof MOVEMENT_OPTIONS)[number];
export type AwarenessObservation = (typeof AWARENESS_OPTIONS)[number];
export type AutonomicObservation = (typeof AUTONOMIC_OPTIONS)[number];
export type PositionObservation = (typeof POSITION_OPTIONS)[number];
export type PreIctalObservation = (typeof PRE_ICTAL_OPTIONS)[number];
export type PostBehaviorObservation = (typeof POST_BEHAVIOR_OPTIONS)[number];
export type OwnerSeverity = (typeof SEVERITY_OPTIONS)[number];

/* ------------------------------------------------------------------ */
/* Breed                                                               */
/* ------------------------------------------------------------------ */
/**
 * Breed is a structured object, never free text. This exists so that future
 * analytics can group dogs reliably instead of drowning in "Golden Retreiver"
 * spelling variants.
 *
 * NOTE for whoever writes those analytics later: you can report "most
 * frequently reported breeds in our dataset". You CANNOT report prevalence or
 * risk without population-level denominator data you do not have.
 */
export const BreedSchema = z.object({
  /** Stable slug of the standardized name, e.g. 'golden-retriever'. */
  breedId: z.string().nullable(),
  /** Standardized display name, or 'Mixed Breed' / 'Unknown' / 'Other'. */
  breedName: z.string(),
  /** Provenance of the standardized value, e.g. 'curated-v1'. */
  breedSource: z.string(),
  /** Owner's own words. Used with 'Mixed Breed' and 'Other'. */
  userEnteredDescription: z.string(),
});
export type Breed = z.infer<typeof BreedSchema>;

/* ------------------------------------------------------------------ */
/* Contacts, medication, emergency plan                                */
/* ------------------------------------------------------------------ */
export const VetContactSchema = z.object({
  name: z.string(),
  clinic: z.string(),
  /** Free-form on purpose: international numbers must not be reformatted. */
  phone: z.string(),
});
export type VetContact = z.infer<typeof VetContactSchema>;

/**
 * Every field here is entered by the owner or their vet.
 * The app must NEVER generate, suggest, or autofill any of it.
 */
export const EmergencyPlanSchema = z.object({
  whenToCall: z.string(),
  medName: z.string(),
  doseRoute: z.string(),
  maxDoses: z.string(),
  special: z.string(),
});
export type EmergencyPlan = z.infer<typeof EmergencyPlanSchema>;

export const MedicationSchema = z.object({
  id: z.string(),
  dogId: z.string(),
  name: z.string().min(1),
  dose: z.string(),
  unit: z.string(),
  frequency: z.string(),
  /** 'HH:MM' 24h local time, or empty string for no reminder. */
  scheduledTime: z.string(),
  prescriber: z.string(),
  /** Set when a repeating local notification is registered for this med. */
  notificationId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Medication = z.infer<typeof MedicationSchema>;

/* ------------------------------------------------------------------ */
/* Dog                                                                 */
/* ------------------------------------------------------------------ */
export const DIAGNOSIS_STATUSES = ['undiagnosed', 'suspected', 'diagnosed'] as const;
export type DiagnosisStatus = (typeof DIAGNOSIS_STATUSES)[number];

export const DogSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  breed: BreedSchema,
  sex: z.enum(['', 'male', 'female']),
  ageYears: z.number().nullable(),
  weightKg: z.number().nullable(),
  dob: z.string(),
  diagnosisStatus: z.enum(DIAGNOSIS_STATUSES),
  firstSeizureDate: z.string(),
  seizureType: z.string(),
  allergies: z.string(),
  diet: z.string(),
  vet: VetContactSchema,
  emergencyVet: VetContactSchema,
  emergencyPlan: EmergencyPlanSchema,
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Dog = z.infer<typeof DogSchema>;

/* ------------------------------------------------------------------ */
/* Seizure                                                             */
/* ------------------------------------------------------------------ */
export const VideoSchema = z.object({
  id: z.string(),
  seizureId: z.string(),
  source: z.enum(['recorded', 'uploaded', 'legacy']),
  /** Path inside the app's document directory. Bytes never go in the DB. */
  fileUri: z.string(),
  timestamp: z.number(),
  durationSec: z.number().nullable(),
  note: z.string(),
});
export type Video = z.infer<typeof VideoSchema>;

/**
 * How much the owner trusts the timestamps. A seizure the owner walked in on
 * halfway through is real data — but it must not be averaged in as if it were
 * stopwatch-accurate. The vet report surfaces this.
 */
export const TIMING_CONFIDENCE = ['exact', 'approximate', 'unknown'] as const;
export type TimingConfidence = (typeof TIMING_CONFIDENCE)[number];

/**
 * Contextual factors around a seizure.
 *
 * KNOWN LIMITATION carried over from the original app: these are free text.
 * The intended upgrade is to link them to real logged entities (a meal log, a
 * sleep log) so intervals can be computed rather than typed. Until then the
 * analytics engine can only use the separately-logged meals and check-ins.
 */
export const SeizureContextSchema = z.object({
  food: z.string(),
  sleep: z.string(),
  exercise: z.string(),
  medication: z.string(),
  stress: z.string(),
  environment: z.string(),
  illness: z.string(),
  exposure: z.string(),
});
export type SeizureContext = z.infer<typeof SeizureContextSchema>;

export const SeizureSchema = z.object({
  id: z.string(),
  dogId: z.string(),

  /** Epoch ms. ALWAYS the source of truth — never a UI tick counter. */
  start: z.number(),
  /** Epoch ms, or null when the owner never saw it end. */
  end: z.number().nullable(),
  /** Derived from start/end when both known; manual only when end is null. */
  durationSec: z.number(),
  timingConfidence: z.enum(TIMING_CONFIDENCE),
  /** True when logged after the fact rather than timed live. */
  retrospective: z.boolean(),

  preIctalObs: z.array(z.string()),
  preIctalNote: z.string(),

  ictalObs: z.array(z.string()),
  awareness: z.string().nullable(),
  autonomic: z.array(z.string()),
  position: z.string().nullable(),

  postBehavior: z.array(z.string()),
  severityOwner: z.string().nullable(),

  recoveryStart: z.number().nullable(),
  recoveryEnd: z.number().nullable(),
  recoverySec: z.number().nullable(),

  context: SeizureContextSchema,
  notes: z.string(),

  /** Cached at write time so history lists don't need a second query. */
  timeSincePrevSec: z.number().nullable(),

  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Seizure = z.infer<typeof SeizureSchema>;

/** A seizure joined with its videos, for detail and edit screens. */
export type SeizureWithVideos = Seizure & { videos: Video[] };

/* ------------------------------------------------------------------ */
/* Daily check-in                                                      */
/* ------------------------------------------------------------------ */
/**
 * The control dataset. Without non-seizure days, every "association" the
 * analytics engine finds is measured against nothing. This is why the app
 * nudges for a 30-second check-in.
 */
export const DailyCheckinSchema = z.object({
  id: z.string(),
  dogId: z.string(),
  timestamp: z.number(),
  sleepHrs: z.number().nullable(),
  appetite: z.enum(['normal', 'increased', 'decreased']),
  water: z.enum(['normal', 'increased', 'decreased']),
  energy: z.number().min(1).max(5),
  stress: z.number().min(1).max(5),
  medOnTime: z.boolean(),
  gi: z.enum(['none', 'vomit', 'diarrhea', 'both']),
  unusual: z.string(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type DailyCheckin = z.infer<typeof DailyCheckinSchema>;

/* ------------------------------------------------------------------ */
/* Meals — the one context entity that is already structured            */
/* ------------------------------------------------------------------ */
export const MealSchema = z.object({
  id: z.string(),
  dogId: z.string(),
  timestamp: z.number(),
  description: z.string(),
  isNewFood: z.boolean(),
  createdAt: z.number(),
});
export type Meal = z.infer<typeof MealSchema>;

/* ------------------------------------------------------------------ */
/* Settings                                                            */
/* ------------------------------------------------------------------ */
/**
 * Thresholds are configurable because individual veterinary care plans differ.
 * The DEFAULTS reflect widely-cited veterinary guidance and should not be
 * removed as a safety net, even though the owner may adjust them.
 */
export const SettingsSchema = z.object({
  thresholdWarnMin: z.number().positive(),
  thresholdCritMin: z.number().positive(),
  clusterWindowHrs: z.number().positive(),
  clusterCount: z.number().int().min(2),
  hapticsEnabled: z.boolean(),
});
export type Settings = z.infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: Settings = {
  thresholdWarnMin: 3,
  thresholdCritMin: 5,
  clusterWindowHrs: 4,
  clusterCount: 2,
  hapticsEnabled: true,
};
