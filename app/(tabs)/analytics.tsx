import { Placeholder } from '@/components/Placeholder';

export default function AnalyticsScreen() {
  return (
    <Placeholder
      title="Patterns"
      summary="Baseline comparison, duration stats, time-of-day distribution and possible associations — every one shown with its sample size and a causation disclaimer."
      todo={[
        'HARD RULE: with fewer than 3 seizures, show only the "not enough data" message and no charts',
        'Baseline vs. last 30 days comparison',
        'Time-of-day histogram across four 6-hour bands',
        'Meal-timing and sleep associations via src/features/analytics',
        'Confidence badge (early / possible / repeated / strong) driven by sample size',
      ]}
    />
  );
}
