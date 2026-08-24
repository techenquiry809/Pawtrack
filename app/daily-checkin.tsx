import { Placeholder } from '@/components/Placeholder';

/**
 * The 30-second daily check-in. This is the control dataset — without
 * non-seizure days there is nothing to compare seizure days against.
 */
export default function DailyCheckinScreen() {
  return (
    <Placeholder
      title="Daily check-in"
      summary="Sleep, appetite, water, energy, stress, medication adherence, GI symptoms and anything unusual. Saves via checkinRepo.upsertTodaysCheckin."
      todo={[
        'Sliders for sleep hours, energy (1-5) and stress (1-5)',
        'Segmented controls for appetite, water and GI',
        'Yes/No for medication given on time',
        'Free-text "anything unusual today"',
        'Prefill from getTodaysCheckin so re-opening edits rather than duplicates',
      ]}
    />
  );
}
