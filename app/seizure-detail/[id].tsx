import { useLocalSearchParams } from 'expo-router';
import { Placeholder } from '@/components/Placeholder';

/**
 * Seizure detail + edit. One screen serves three jobs: viewing a record,
 * editing it, and creating a retrospective one. Everything must stay editable
 * after the fact — an owner mid-seizure cannot answer accurately.
 */
export default function SeizureDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  return (
    <Placeholder
      title="Seizure detail"
      summary={`Full record view and editor (id: ${id ?? 'new'}). Loads via seizureRepo.getSeizure, saves via updateSeizure with an audit-trail summary.`}
      todo={[
        'Timing section: confidence (exact/approximate/unknown), start, end or estimated duration',
        'All observation chip groups, prefilled from the record',
        'Recovery seconds, context fields, notes',
        'Videos: list, view, remove, record new, upload existing (videoService)',
        'Every save passes a human-readable editSummary for the audit trail',
        'Delete with confirmation',
      ]}
    />
  );
}
