/**
 * The active seizure timer.
 *
 * THIS IS THE MOST SAFETY-CRITICAL FILE IN THE APP. Read this comment before
 * changing anything in it.
 *
 * ── Rule 1: elapsed time is never a tick counter ──────────────────────
 * Elapsed time is ALWAYS derived from an absolute mark. We never accumulate a
 * counter on every tick. A tick counter drifts, stops when the JS thread is
 * suspended, and silently under-reports duration — which for this app could
 * mean an owner not being warned that they have crossed the five-minute mark.
 *
 * The interval in useSeizureTimer exists ONLY to trigger a re-render. If the OS
 * suspends us for 90 seconds and then resumes, the very next render shows the
 * correct, real elapsed time.
 *
 * ── Rule 2: SQLite owns the record, not this store ────────────────────
 * This store used to BE the seizure until recovery.tsx saved it, which made it
 * an exception to the app's own rule that SQLite holds one copy of a record —
 * and that exception is exactly where the data-loss bug lived. A force-quit or
 * OS memory kill during a seizure lost it entirely, and since the owner is
 * often holding the camera open at that moment, the kill is expected behaviour
 * rather than an edge case.
 *
 * Now the row is inserted on the first tap and this store is a cache of it.
 * Writes go out ALONGSIDE the render, never in front of it.
 *
 * ── Rule 3: startedAtMono is memory-only, on purpose ──────────────────
 * The monotonic mark's origin is session-specific, so persisting it would be
 * worse than useless. Its absence after a relaunch is precisely how we know a
 * row is an orphan. See src/utils/clock.ts.
 */

import { create } from 'zustand';
import * as seizureRepo from '@/db/seizureRepo';
import { markEnd, markStart, type EndMark, type StartMark } from '@/utils/clock';
import type { SeizureContext, TimingConfidence } from '@/types/domain';

export type ActiveStage = 'live' | 'post' | 'recovery';

export type ActiveSeizureDraft = {
  dogId: string;
  /** Row id in SQLite. Null only while the opening insert is still in flight. */
  seizureId: string | null;
  /** Wall + monotonic marks. The monotonic half is never persisted. */
  mark: StartMark;
  /** Epoch ms. Kept for the screens that already read it. */
  startedAt: number;
  endedAt: number | null;
  /**
   * Wall + monotonic marks for the moment the timer was STOPPED. Null until
   * endSeizure() runs. The monotonic half is never persisted, exactly like
   * mark.startedAtMono — see Rule 3 above.
   *
   * This is what the final duration is measured to. Measuring to save time
   * instead folded the post-seizure and recovery screens into the number.
   */
  endMark: EndMark | null;
  stage: ActiveStage;

  /** True when the opening INSERT failed. Timing continues regardless. */
  isUnpersisted: boolean;

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

  /**
   * Videos recorded during this seizure, before it is saved to the DB.
   *
   * `thumbUri` is extracted at capture time rather than lazily in the gallery:
   * pulling a frame out of a video is slow, and doing it while scrolling a grid
   * of twenty tiles is exactly the wrong moment. '' when extraction failed.
   */
  pendingVideos: {
    fileUri: string;
    thumbUri: string;
    timestamp: number;
    durationSec: number | null;
  }[];

  /** Threshold alerts already fired, so haptics/alerts don't repeat. */
  firedThresholds: number[];
};

type ActiveSeizureState = {
  draft: ActiveSeizureDraft | null;

  start: (dogId: string) => void;
  /**
   * Explicit DISCARD. Marks the row abandoned. Only for a seizure the owner
   * chose to throw away.
   */
  cancel: () => void;
  /**
   * Drops the in-memory draft WITHOUT touching the row.
   *
   * This is the success path. It exists because it used to be `cancel`, which
   * marked every seizure abandoned the instant after it was saved — and since
   * every read filters on status='complete', every saved seizure vanished.
   * Saving and discarding are opposite outcomes and must not share an action.
   */
  clearDraft: () => void;

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

/* ------------------------------------------------------------------ */
/* Write coalescing                                                     */
/* ------------------------------------------------------------------ */
/**
 * Chip taps arrive in bursts. Each one is durable within a third of a second,
 * which is far below the interval at which an app actually gets killed, and
 * batching them keeps us off the JS thread during the one moment the UI must
 * stay responsive.
 *
 * finalizeSeizure() is additionally handed the whole draft, so a patch still
 * sitting in this buffer when the owner finishes is never lost.
 */
const PATCH_DEBOUNCE_MS = 350;

let pendingPatch: seizureRepo.SeizurePatch = {};
let flushTimer: ReturnType<typeof setTimeout> | null = null;

async function flushPatch(seizureId: string): Promise<void> {
  const patch = pendingPatch;
  pendingPatch = {};
  if (Object.keys(patch).length === 0) return;
  try {
    await seizureRepo.patchSeizure(seizureId, patch);
  } catch (error) {
    // Never surface this. The in-memory draft is still correct, the owner is
    // watching their dog, and finalize will write the whole record anyway.
    console.error('[activeSeizure] patch failed', error);
  }
}

function schedulePatch(
  draft: ActiveSeizureDraft | null,
  patch: seizureRepo.SeizurePatch,
): void {
  if (!draft || draft.isUnpersisted) return;
  pendingPatch = { ...pendingPatch, ...patch };
  const id = draft.seizureId;
  if (!id || flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    void flushPatch(id);
  }, PATCH_DEBOUNCE_MS);
}

/** Phase transitions bypass the debounce — they are the crash-recovery anchor. */
function writeNow(
  draft: ActiveSeizureDraft | null,
  patch: seizureRepo.SeizurePatch,
): void {
  if (!draft?.seizureId || draft.isUnpersisted) return;
  void flushPatch(draft.seizureId).then(() =>
    seizureRepo.patchSeizure(draft.seizureId as string, patch),
  ).catch((error) => console.error('[activeSeizure] phase write failed', error));
}

function clearPending(): void {
  if (flushTimer) clearTimeout(flushTimer);
  flushTimer = null;
  pendingPatch = {};
}

export const useActiveSeizure = create<ActiveSeizureState>((set, get) => ({
  draft: null,

  /**
   * Ordering here is deliberate and inverts the usual write-then-render rule.
   *
   * We set the in-memory draft FIRST so the live screen renders and starts
   * counting immediately, then write to the database. If the insert fails the
   * timer is already running and the owner is not left staring at a spinner
   * during a seizure. `isUnpersisted` records the failure so the final save can
   * write the whole record instead of losing it.
   */
  start: (dogId) => {
    clearPending();
    const mark = markStart();
    set({
      draft: {
        dogId,
        seizureId: null,
        mark,
        startedAt: mark.startedAtUtc,
        endedAt: null,
        endMark: null,
        stage: 'live',
        isUnpersisted: false,
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
    });

    void seizureRepo
      .openSeizure({
        dogId,
        startedAtUtc: mark.startedAtUtc,
        tzOffsetMin: mark.tzOffsetMin,
      })
      .then((seizureId) => {
        set((state) =>
          state.draft ? { draft: { ...state.draft, seizureId } } : state,
        );
      })
      .catch((error) => {
        // Degrade, never block. Keep timing in memory and flag it so the
        // final save can attempt the insert again.
        console.error('[activeSeizure] open failed, continuing in memory', error);
        set((state) =>
          state.draft ? { draft: { ...state.draft, isUnpersisted: true } } : state,
        );
      });
  },

  /**
   * The seizure was saved. Let go of the draft and leave the row alone.
   *
   * clearPending() drops any debounced patch still in the buffer, which is
   * correct here: finalizeSeizure() is handed the whole draft, so everything in
   * that buffer has already been written by the time we get here.
   */
  clearDraft: () => {
    clearPending();
    set({ draft: null });
  },

  /** Explicit discard. Soft-deletes the row rather than removing it. */
  cancel: () => {
    const { draft } = get();
    clearPending();
    if (draft?.seizureId) {
      void seizureRepo
        .discardSeizure(draft.seizureId)
        .catch((error) => console.error('[activeSeizure] discard failed', error));
    }
    set({ draft: null });
  },

  toggleMulti: (field, value) =>
    set((state) => {
      if (!state.draft) return state;
      const current = state.draft[field];
      const next = current.includes(value)
        ? current.filter((v) => v !== value)
        : [...current, value];
      const draft = { ...state.draft, [field]: next };
      schedulePatch(draft, { [field]: next });
      return { draft };
    }),

  setSingle: (field, value) =>
    set((state) => {
      if (!state.draft) return state;
      // Tapping the selected option again clears it.
      const next = state.draft[field] === value ? null : value;
      const draft = { ...state.draft, [field]: next };
      schedulePatch(draft, { [field]: next });
      return { draft };
    }),

  setField: (field, value) =>
    set((state) => {
      if (!state.draft) return state;
      const draft = { ...state.draft, [field]: value };
      // Only fields that map to a column are worth persisting; the rest
      // (pendingVideos, firedThresholds, stage) are session concerns.
      if (
        field === 'preIctalNote' ||
        field === 'notes' ||
        field === 'context' ||
        field === 'timingConfidence'
      ) {
        schedulePatch(draft, { [field]: value } as seizureRepo.SeizurePatch);
      }
      return { draft };
    }),

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
    set((state) => {
      if (!state.draft) return state;
      // Both clocks read at the same instant. endedAt is what goes in the
      // column; endMark.endedAtMono is what the duration is actually measured
      // against, and never leaves memory.
      const end = markEnd();
      const draft = {
        ...state.draft,
        endedAt: end.endedAtUtc,
        endMark: end,
        stage: 'post' as const,
      };
      writeNow(draft, { end: end.endedAtUtc });
      return { draft };
    }),

  beginRecovery: () =>
    set((state) => {
      if (!state.draft) return state;
      const recoveryStartedAt = Date.now();
      const draft = {
        ...state.draft,
        stage: 'recovery' as const,
        recoveryStartedAt,
      };
      writeNow(draft, { recoveryStart: recoveryStartedAt });
      return { draft };
    }),

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

/** Clears any buffered write. Call after the record is committed. */
export function resetPendingWrites(): void {
  clearPending();
}

/** Derived helper — always recomputed, never cached. */
export function elapsedSeconds(startedAt: number, now = Date.now()): number {
  return Math.max(0, Math.floor((now - startedAt) / 1000));
}
