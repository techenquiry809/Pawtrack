import { Placeholder } from '@/components/Placeholder';

/**
 * Recovery tracking. "Back to normal" auto-records recovery duration so the
 * owner never has to work out elapsed time themselves.
 */
export default function RecoveryScreen() {
  return (
    <Placeholder
      title="Recovery"
      summary="Live counter since the seizure ended, with a one-tap 'Back to normal' that records recovery duration automatically."
      todo={[
        'Live elapsed counter from draft.recoveryStartedAt (absolute timestamps)',
        '"Back to normal" -> set recoveryEnd, compute recoverySec, save via seizureRepo.createSeizure',
        '"Save and finish later" -> save without recovery data, completable later from History',
        'Persist pendingVideos via seizureRepo.attachVideo after the seizure row exists',
      ]}
    />
  );
}
