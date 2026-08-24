import { Placeholder } from '@/components/Placeholder';

/**
 * Post-seizure questions. Uses progressive disclosure — the owner has just
 * been through something distressing, so this must not present as one giant
 * form.
 */
export default function PostSeizureScreen() {
  return (
    <Placeholder
      title="Right after the seizure"
      summary="Duration readout, then short structured questions: current behaviour, pre-seizure signs, owner-observed severity, notes."
      todo={[
        'Show auto-calculated duration and time since previous seizure',
        'POST_BEHAVIOR_OPTIONS chips (multi-select)',
        'PRE_ICTAL_OPTIONS chips + free-text note',
        'SEVERITY_OPTIONS chips, labelled "owner-observed", never clinical',
        'Continue button -> beginRecovery() -> /seizure/recovery',
      ]}
    />
  );
}
