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
import { DURATION_CONFIDENCES, MAX_PLAUSIBLE_SEIZURE_SECONDS } from '@/utils/clock';

export type { DurationConfidence } from '@/utils/clock';

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
  /**
   * Owner's own words. Used with 'Mixed Breed' and 'Other'.
   *
   * CAPPED ON PURPOSE. This is the only owner-controlled string on the breed
   * picker, and it is destined for a generated vet report. When that report
   * ships as HTML through expo-print, this value must ALSO be escaped at
   * render — an unescaped `<` in a PDF template is an injection vector, and a
   * length cap alone does not close it.
   */
  userEnteredDescription: z.string().max(200),
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
  name: z.string().min(1).max(120),
  /** What the vet prescribed, as the owner typed it. Never suggested by us. */
  dose: z.string().max(60),
  unit: z.string().max(30),
  frequency: z.string().max(60),
  prescriber: z.string().max(120),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type Medication = z.infer<typeof MedicationSchema>;

/**
 * A reminder time, in its own table rather than a column on the medication.
 *
 * Dogs on anticonvulsants are routinely dosed two or three times a day, so a
 * single nullable time column would have needed rebuilding immediately.
 *
 * `timeHHMM` is LOCAL WALL-CLOCK time, never an instant. An owner who flies to
 * another timezone still needs their 8am reminder at 8am.
 */
export const REMINDER_TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

export const MedicationReminderSchema = z.object({
  id: z.string(),
  medicationId: z.string(),
  timeHHMM: z.string().regex(REMINDER_TIME_RE, 'Use a 24-hour time like 08:00'),
  enabled: z.boolean(),
  /** Handle from expo-notifications, so we can cancel exactly this one. */
  notificationId: z.string().nullable(),
  createdAt: z.number(),
  updatedAt: z.number(),
});
export type MedicationReminder = z.infer<typeof MedicationReminderSchema>;

export type MedicationWithReminders = Medication & {
  reminders: MedicationReminder[];
};

/**
 * What actually happened, which is a different question from what was
 * prescribed. Always owner-reported — the app never infers a status, because
 * "you did not open the app" is not evidence a dose was missed.
 */
export const DOSE_STATUSES = ['given', 'late', 'missed'] as const;
export type DoseStatus = (typeof DOSE_STATUSES)[number];

export const DOSE_STATUS_LABEL: Record<DoseStatus, string> = {
  given: 'Given on time',
  late: 'Given late',
  missed: 'Not given',
};

export const MedicationDoseSchema = z.object({
  id: z.string(),
  medicationId: z.string(),
  dogId: z.string(),
  /** Local calendar day, 'YYYY-MM-DD'. */
  doseDate: z.string(),
  /** The reminder slot this belongs to, or '' for an ad-hoc record. */
  scheduledHHMM: z.string(),
  status: z.enum(DOSE_STATUSES),
  recordedAt: z.number(),
  note: z.string().max(500),
  createdAt: z.number(),
});
export type MedicationDose = z.infer<typeof MedicationDoseSchema>;

/* ------------------------------------------------------------------ */
/* Dog                                                                 */
/* ------------------------------------------------------------------ */
export const DIAGNOSIS_STATUSES = ['undiagnosed', 'suspected', 'diagnosed'] as const;
export type DiagnosisStatus = (typeof DIAGNOSIS_STATUSES)[number];

export const DogSchema = z.object({
  id: z.string(),
  name: z.string().min(1),
  /** Path in the document directory, or '' for none. Bytes never go in the DB. */
  photoUri: z.string(),
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

/**
 * Lifecycle of the seizure RECORD — not a clinical field, and never shown to
 * the owner as one. The row is inserted `in_progress` on the first tap so a
 * crash cannot lose it; only `complete` rows may reach history or a vet report.
 */
export const SEIZURE_STATUSES = ['in_progress', 'complete', 'abandoned'] as const;
export type SeizureStatus = (typeof SEIZURE_STATUSES)[number];

export const SeizureStatusSchema = z.enum(SEIZURE_STATUSES);
export const DurationConfidenceSchema = z.enum(DURATION_CONFIDENCES);

export const SeizureSchema = z.object({
  id: z.string(),
  dogId: z.string(),

  status: SeizureStatusSchema,
  durationConfidence: DurationConfidenceSchema,
  /** Last phase transition written. Powers honest crash-recovery durations. */
  lastTouchedAt: z.number().nullable(),
  /** Minutes ahead of UTC at capture time, e.g. Kathmandu = 345. */
  tzOffsetMin: z.number().nullable(),

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

/**
 * The finalize gate — the last point a bad duration can be stopped before it
 * becomes a fact a vet reads.
 *
 * Every rule here is a REFUSAL, never a correction. A silently repaired
 * duration is indistinguishable from a measured one in an export; a refusal
 * produces a question, a correction produces a false fact.
 */
export const SeizureFinalizeSchema = z
  .object({
    durationSeconds: z
      .number()
      .int()
      .min(0)
      .max(MAX_PLAUSIBLE_SEIZURE_SECONDS)
      .nullable(),
    durationConfidence: DurationConfidenceSchema,
  })
  .superRefine((value, ctx) => {
    // "We don't know how long" paired with "we're confident" is a
    // contradiction that would let an unreliable row pass as a good one.
    if (value.durationSeconds === null && value.durationConfidence === 'high') {
      ctx.addIssue({
        code: 'custom',
        path: ['durationConfidence'],
        message: 'A missing duration cannot be high confidence. Use "unreliable".',
      });
    }
    // A zero-second seizure is a double-tap, not an event.
    if (value.durationSeconds === 0) {
      ctx.addIssue({
        code: 'custom',
        path: ['durationSeconds'],
        message: 'A zero-second seizure is a mis-tap. Discard the record instead.',
      });
    }
  });
export type SeizureFinalize = z.infer<typeof SeizureFinalizeSchema>;

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
  /**
   * Local calendar day, 'YYYY-MM-DD'. This is the real key — a unique index on
   * (dog_id, check_in_date) is what guarantees one check-in per day, rather
   * than app code remembering to look first.
   */
  checkInDate: z.string(),
  /**
   * True when filled in after the day it describes. Recalled from memory is
   * weaker evidence than recorded that evening, and this is the control
   * dataset the pattern analysis compares seizure days against — so the
   * distinction is stored rather than lost.
   */
  backfilled: z.boolean(),
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
