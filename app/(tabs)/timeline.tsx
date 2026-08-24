import { Placeholder } from '@/components/Placeholder';

export default function TimelineScreen() {
  return (
    <Placeholder
      title="Timeline"
      summary="Chronological feed of seizures, medications and check-ins, grouped by day. Tapping a seizure opens the shared detail/edit screen."
      todo={[
        'Query seizures + medAdmins + checkins, merge and sort by timestamp',
        'Group by local day with a section header per day',
        'Colour-coded dot per event type (red seizure, green medication, teal check-in)',
        'Filter control for event type',
      ]}
    />
  );
}
