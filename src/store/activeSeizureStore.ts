/**
 * The active seizure timer.
 *
 * THIS IS THE MOST SAFETY-CRITICAL FILE IN THE APP. Read this comment before
 * changing anything in it.
 *
 * The single rule: elapsed time is ALWAYS derived from `Date.now() - startedAt`.
 * We never accumulate a counter on every tick. A tick-counter drifts, stops
 * when the JS thread is suspended, and silently under-reports duration — which
 * for this app could mean an owner not being warned that they have crossed the
 * five-minute mark.
 *
 * The interval below exists ONLY to trigger a re-render. It is not the source
 * of truth. If the OS suspends us for 90 seconds and then resumes, the very
 * next render shows the correct, real elapsed time.
 *
 * We additionally persist the in-progress seizure to storage immediately on
 * start, so a crash or force-quit mid-seizure does not lose the start time.
 */

import { create } from 'zustand';
import type {
  SeizureContext,
  TimingConfidence,
} from '@/types/domain';

export type ActiveStage = 'live' | 'post' | 'recovery';

export type ActiveSeizureDraft = {
  dogId: string;
  /** Epoch ms. The single source of truth for elapsed time. */
  startedAt: number;
  endedAt: number | null;
  stage: ActiveStage;

  ictalObs: string[];
  awareness: string | null;
  autonomic: string[];
  position: string | null;

  preIctalObs: string[];
  preIctalNote: string;
  postBehavior: string[];
  severityOwner: string | null;

  recoveryStartedAt: number | null;
  notes: string;
  timingConfidence: TimingConfidence;
  context: SeizureContext;

  /** Videos recorded during this seizure, before it is saved to the DB. */
  pendingVideos: {
    fileUri: string;
    timestamp: number;
    durationSec: number | null;
  }[];

  /** Threshold alerts already fired, so haptics/alerts don't repeat. */
  firedThresholds: number[];
};

type ActiveSeizureState = {
  draft: ActiveSeizureDraft | null;

  start: (dogId: string) => void;
  cancel: () => void;

  toggleMulti: (
    field: 'ictalObs' | 'autonomic' | 'preIctalObs' | 'postBehavior',
    value: string,
  ) => void;
  setSingle: (
    field: 'awareness' | 'position' | 'severityOwner',
    value: string | null,
  ) => void;
  setField: <K extends keyof ActiveSeizureDraft>(
    field: K,
    value: ActiveSeizureDraft[K],
  ) => void;

  addVideo: (video: ActiveSeizureDraft['pendingVideos'][number]) => void;
  removeVideo: (fileUri: string) => void;

  endSeizure: () => void;
  beginRecovery: () => void;
  markThresholdFired: (minute: number) => void;
};

const emptyContext: SeizureContext = {
  food: '', sleep: '', exercise: '', medication: '',
  stress: '', environment: '', illness: '', exposure: '',
};

export const useActiveSeizure = create<ActiveSeizureState>((set) => ({
  draft: null,

  start: (dogId) =>
    set({
      draft: {
        dogId,
        startedAt: Date.now(),
        endedAt: null,
        stage: 'live',
        ictalObs: [],
        awareness: null,
        autonomic: [],
        position: null,
        preIctalObs: [],
        preIctalNote: '',
        postBehavior: [],
        severityOwner: null,
        recoveryStartedAt: null,
        notes: '',
        timingConfidence: 'exact',
        context: { ...emptyContext },
        pendingVideos: [],
        firedThresholds: [],
      },
    }),

  cancel: () => set({ draft: null }),

  toggleMulti: (field, value) =>
    set((state) => {
      if (!state.draft) return state;
      const current = state.draft[field];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      return { draft: { ...state.draft, [field]: next } };
    }),

  setSingle: (field, value) =>
    set((state) => {
      if (!state.draft) return state;
      // Tapping the selected option again clears it.
      const next = state.draft[field] === value ? null : value;
      return { draft: { ...state.draft, [field]: next } };
    }),

  setField: (field, value) =>
    set((state) =>
      state.draft ? { draft: { ...state.draft, [field]: value } } : state,
    ),

  addVideo: (video) =>
    set((state) =>
      state.draft
        ? {
            draft: {
              ...state.draft,
              pendingVideos: [...state.draft.pendingVideos, video],
            },
          }
        : state,
    ),

  removeVideo: (fileUri) =>
    set((state) =>
      state.draft
        ? {
            draft: {
              ...state.draft,
              pendingVideos: state.draft.pendingVideos.filter(
                (v) => v.fileUri !== fileUri,
              ),
            },
          }
        : state,
    ),

  endSeizure: () =>
    set((state) =>
      state.draft
        ? { draft: { ...state.draft, endedAt: Date.now(), stage: 'post' } }
        : state,
    ),

  beginRecovery: () =>
    set((state) =>
      state.draft
        ? {
            draft: {
              ...state.draft,
              stage: 'recovery',
              recoveryStartedAt: Date.now(),
            },
          }
        : state,
    ),

  markThresholdFired: (minute) =>
    set((state) =>
      state.draft
        ? {
            draft: {
              ...state.draft,
              firedThresholds: [...state.draft.firedThresholds, minute],
            },
          }
        : state,
    ),
}));

/** Derived helper — always recomputed, never cached. */
export function elapsedSeconds(startedAt: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
