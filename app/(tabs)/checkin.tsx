/**
 * Daily Check-in tab — two sections behind a segmented control.
 *
 * This tab replaced Timeline. The merged day-by-day feed was not deleted: it
 * moved into History as its "Everything" filter, sharing one merge definition
 * in src/features/timeline.
 *
 * Check-in and Medication live together because they answer the same daily
 * question — what happened today that was not a seizure — and the check-in's
 * "was medication given on time?" is answered by the dose log one tab section
 * away.
 */

import { useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Muted, SegmentedControl, Title } from '@/components/ui';
import { CheckinSection } from '@/components/CheckinSection';
import { MedicationSection } from '@/components/MedicationSection';
import { colors, spacing } from '@/theme/tokens';
import { useChromeMetrics } from '@/theme/chrome';
import { useActiveDog } from '@/store/appStore';

type Section = 'checkin' | 'medication';

export default function CheckinTab() {
  const insets = useSafeAreaInsets();
  const { contentClearance } = useChromeMetrics();
  const dog = useActiveDog();

  // Lets Home and a tapped reminder land on the right section.
  const params = useLocalSearchParams<{ section?: string }>();
  const [section, setSection] = useState<Section>(
    params.section === 'medication' ? 'medication' : 'checkin',
  );

  if (!dog) return null;

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: contentClearance },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <Title>Daily check-in</Title>
      <Muted style={styles.intro}>
        Recording ordinary days is what gives seizure days something to stand
        out from.
      </Muted>

      <View style={styles.switcher}>
        <SegmentedControl<Section>
          accessibilityLabel="Choose a section"
          value={section}
          onChange={setSection}
          options={[
            { value: 'checkin', label: 'Check-in' },
            { value: 'medication', label: 'Medication' },
          ]}
        />
      </View>

      {section === 'checkin' ? (
        <CheckinSection dogId={dog.id} dogName={dog.name} />
      ) : (
        <MedicationSection dogId={dog.id} dogName={dog.name} />
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  intro: { marginTop: spacing.sm },
  switcher: { marginTop: spacing.md, marginBottom: spacing.md },
});
