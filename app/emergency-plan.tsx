/**
 * SAFETY-CRITICAL SCREEN.
 *
 * Every field here is entered by the owner or their veterinarian. The app must
 * never generate, suggest, autofill or infer any of this content — especially
 * not medication names or doses. There is no placeholder text on the treatment
 * fields for exactly this reason: a suggestive placeholder is a suggestion.
 *
 * This screen also exists to make the live screen honest. Until it shipped, the
 * emergency-vet buttons on app/seizure/live.tsx could never work, because there
 * was nowhere in the app to enter a phone number. A control that implies
 * emergency capability and delivers nothing is worse than no control at all.
 *
 * Phone numbers are stored exactly as typed. Never reformat or validate them to
 * one country's shape — an owner travelling with their dog needs the number
 * that actually dials.
 */

import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Card, Disclaimer, Heading, Muted, Title } from '@/components/ui';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';
import { goBackOrHome } from '@/utils/nav';
import { BackButton } from '@/components/BackButton';
import { useActiveDog, useAppStore } from '@/store/appStore';
import * as dogRepo from '@/db/dogRepo';
import type { EmergencyPlan, VetContact } from '@/types/domain';

const EMPTY_CONTACT: VetContact = { name: '', clinic: '', phone: '' };
const EMPTY_PLAN: EmergencyPlan = {
  whenToCall: '', medName: '', doseRoute: '', maxDoses: '', special: '',
};

export default function EmergencyPlanScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dog = useActiveDog();
  const refreshDogs = useAppStore((s) => s.refreshDogs);

  const [vet, setVet] = useState<VetContact>(EMPTY_CONTACT);
  const [emergencyVet, setEmergencyVet] = useState<VetContact>(EMPTY_CONTACT);
  const [plan, setPlan] = useState<EmergencyPlan>(EMPTY_PLAN);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Prefill so reopening edits rather than blanks what is already saved.
  useEffect(() => {
    if (!dog) return;
    setVet(dog.vet);
    setEmergencyVet(dog.emergencyVet);
    setPlan(dog.emergencyPlan);
  }, [dog]);

  if (!dog) return null;

  const onSave = async () => {
    setSaving(true);
    setError(null);
    try {
      await dogRepo.updateDog(dog.id, { vet, emergencyVet, emergencyPlan: plan });
      await refreshDogs();
      goBackOrHome(router);
    } catch (e) {
      console.error('[emergency-plan] save failed', e);
      setError('Could not save. Please try again.');
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
      keyboardShouldPersistTaps="handled"
    >
      <BackButton />
      <Title>Emergency plan</Title>
      <Muted style={styles.intro}>
        Your vet&apos;s numbers, and the instructions they gave you. Everything
        here is yours to write — the app never fills any of it in.
      </Muted>

      {/* --- Contacts ------------------------------------------------- */}
      <SectionCard
        title="Emergency vet"
        subtitle="The out-of-hours clinic. This is the number the live seizure screen dials first."
        contact={emergencyVet}
        onChange={setEmergencyVet}
      />

      <SectionCard
        title="Primary vet"
        subtitle="Your usual practice."
        contact={vet}
        onChange={setVet}
      />

      {/* --- Plan ----------------------------------------------------- */}
      <Card>
        <Heading>Instructions from your vet</Heading>
        <Muted style={styles.cardIntro}>
          Write these down exactly as your veterinarian gave them to you.
        </Muted>

        <Field
          label="WHEN TO CALL"
          value={plan.whenToCall}
          onChangeText={(whenToCall) => setPlan((p) => ({ ...p, whenToCall }))}
          multiline
        />
        <Field
          label="RESCUE MEDICATION"
          value={plan.medName}
          onChangeText={(medName) => setPlan((p) => ({ ...p, medName }))}
        />
        <Field
          label="DOSE AND ROUTE"
          value={plan.doseRoute}
          onChangeText={(doseRoute) => setPlan((p) => ({ ...p, doseRoute }))}
        />
        <Field
          label="MAXIMUM DOSES"
          value={plan.maxDoses}
          onChangeText={(maxDoses) => setPlan((p) => ({ ...p, maxDoses }))}
        />
        <Field
          label="SPECIAL INSTRUCTIONS"
          value={plan.special}
          onChangeText={(special) => setPlan((p) => ({ ...p, special }))}
          multiline
        />
      </Card>

      {error ? <Body style={styles.error}>{error}</Body> : null}

      <Button label="Save" large loading={saving} onPress={() => void onSave()} />

      <Disclaimer>
        This screen stores what your veterinarian told you. It is not medical
        advice, and the app will never suggest a medication, a dose, or an
        action to take during a seizure.
      </Disclaimer>
    </ScrollView>
  );
}

function SectionCard({
  title,
  subtitle,
  contact,
  onChange,
}: {
  title: string;
  subtitle: string;
  contact: VetContact;
  onChange: (next: VetContact) => void;
}) {
  return (
    <Card>
      <Heading>{title}</Heading>
      <Muted style={styles.cardIntro}>{subtitle}</Muted>
      <Field
        label="PHONE"
        value={contact.phone}
        onChangeText={(phone) => onChange({ ...contact, phone })}
        keyboardType="phone-pad"
      />
      <Field
        label="CLINIC"
        value={contact.clinic}
        onChangeText={(clinic) => onChange({ ...contact, clinic })}
      />
      <Field
        label="CONTACT NAME"
        value={contact.name}
        onChangeText={(name) => onChange({ ...contact, name })}
      />
    </Card>
  );
}

function Field({
  label,
  value,
  onChangeText,
  multiline = false,
  keyboardType,
}: {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  multiline?: boolean;
  keyboardType?: 'phone-pad';
}) {
  return (
    <View>
      <Muted style={styles.label}>{label}</Muted>
      <TextInput
        style={[styles.input, multiline && styles.inputTall]}
        value={value}
        onChangeText={onChangeText}
        multiline={multiline}
        keyboardType={keyboardType}
        // No placeholder on purpose: on the treatment fields a suggestive
        // example would read as the app recommending something.
        accessibilityLabel={label.toLowerCase()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  intro: { marginTop: spacing.sm, marginBottom: spacing.md },
  cardIntro: { marginTop: 4, marginBottom: spacing.sm },
  label: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: spacing.md,
    marginBottom: 6,
    fontFamily: fontFamily.bold
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    fontSize: fontSize.md,
    color: colors.ink,
    backgroundColor: colors.bg,
    fontFamily: fontFamily.regular
  },
  inputTall: { minHeight: 88, paddingTop: spacing.md, textAlignVertical: 'top' },
  error: { color: colors.redDeep, marginBottom: spacing.sm },
});
