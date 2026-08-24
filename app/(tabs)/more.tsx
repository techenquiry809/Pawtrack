import { Placeholder } from '@/components/Placeholder';

export default function MoreScreen() {
  return (
    <Placeholder
      title="More"
      summary="Settings hub: dog profile, emergency plan, medications, veterinarian report and app settings."
      todo={[
        'Navigation rows to profile, emergency-plan, medications, vet-report, settings',
        'Dog switcher for multi-dog households',
        'Standing medical disclaimer at the foot of the screen',
      ]}
    />
  );
}
