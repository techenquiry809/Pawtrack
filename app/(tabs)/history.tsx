import { Placeholder } from '@/components/Placeholder';

export default function HistoryScreen() {
  return (
    <Placeholder
      title="Seizure history"
      summary="List of every recorded seizure, newest first, plus the entry point for logging a seizure retrospectively."
      todo={[
        '"+ Add seizure record" button routing to the shared edit screen in create mode',
        'FlatList of seizures with date, time, duration pill and top observations',
        'Duration pill colour: red >= 5 min, amber >= 3 min, teal otherwise',
        '"Retrospective" badge when seizure.retrospective is true',
      ]}
    />
  );
}
