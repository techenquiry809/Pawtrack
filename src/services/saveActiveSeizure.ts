/**
 * Commits the in-progress seizure.
 *
 * WHAT CHANGED: this used to INSERT the whole record at the end, which meant a
 * crash before this ran lost the seizure. The row now exists from the first tap
 * (see seizureRepo.openSeizure), so this function's job is to write the final
 * duration and flip the row to `complete` — the point at which it becomes
 * visible to history, analytics and vet reports.
 *
 * The draft is passed to finalize in full, so any observation still sitting in
 * the store's debounce buffer is written here rather than lost.
 *
 * ORDERING MATTERS: the seizure row must be complete before videos are attached
 * — a video row has a foreign key to a seizure.
 */

import * as seizureRepo from '@/db/seizureRepo';
import { resolveDuration } from '@/utils/clock';
import { resetPendingWrites, type ActiveSeizureDraft } from '@/store/activeSeizureStore';

export type SaveResult = {
  seizureId: string;
  /** Videos whose DB row could not be written. The files are still on disk. */
  failedVideos: number;
};

/** Everything the draft knows that maps to a column. */
function fullPatch(
  draft: ActiveSeizureDraft,
  recoveryEndedAt: number | null,
): seizureRepo.SeizurePatch {
  return {
    end: draft.endedAt,
    preIctalObs: draft.preIctalObs,
    preIctalNote: draft.preIctalNote,
    ictalObs: draft.ictalObs,
    awareness: draft.awareness,
    autonomic: draft.autonomic,
    position: draft.position,
    postBehavior: draft.postBehavior,
    severityOwner: draft.severityOwner,
    recoveryStart: draft.recoveryStartedAt,
    recoveryEnd: recoveryEndedAt,
    context: draft.context,
    notes: draft.notes,
    timingConfidence: draft.timingConfidence,
  };
}

export async function saveActiveSeizure(
  draft: ActiveSeizureDraft,
  recoveryEndedAt: number | null,
): Promise<SaveResult> {
  resetPendingWrites();

  // Monotonic where available, so a wall-clock jump mid-seizure cannot corrupt
  // a figure a vet may adjust a dose from.
  //
  // MEASURED TO draft.endMark, NOT TO NOW. `now` is save time, which is after
  // the post-seizure questionnaire and the whole recovery screen — on a real
  // seizure that is minutes of the owner's admin folded into the clinical
  // duration and stamped 'high'. endMark is the instant they stopped the timer.
  const { durationSeconds, confidence } = resolveDuration(
    draft.mark,
    draft.endMark,
  );
  const patch = fullPatch(draft, recoveryEndedAt);

  let seizureId = draft.seizureId;

  if (seizureId === null || draft.isUnpersisted) {
    // The opening insert never landed. Write the whole record now rather than
    // losing a seizure the owner has already lived through.
    seizureId = await seizureRepo.openSeizure({
      dogId: draft.dogId,
      startedAtUtc: draft.mark.startedAtUtc,
      tzOffsetMin: draft.mark.tzOffsetMin,
    });
  }

  await seizureRepo.finalizeSeizure(
    seizureId,
    { durationSeconds, durationConfidence: confidence },
    patch,
  );

  // A failed video attachment must never lose the seizure record itself — the
  // clinical data is what matters. Count failures and let the caller say so.
  let failedVideos = 0;
  for (const video of draft.pendingVideos) {
    try {
      await seizureRepo.attachVideo({
        seizureId,
        source: 'recorded',
        fileUri: video.fileUri,
        thumbUri: video.thumbUri,
        // The app held the stopwatch, so this timestamp is measured. That is
        // what separates it from an imported clip whose date the owner typed.
        timestamp: video.timestamp,
        importedAt: Date.now(),
        captureConfidence: 'device',
        durationSec: video.durationSec,
        note: '',
      });
    } catch (e) {
      failedVideos += 1;
      console.error('[save] could not attach video', e);
    }
  }

  return { seizureId, failedVideos };
}
