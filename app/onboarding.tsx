import { useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Card, Disclaimer, Heading, Muted, Title } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';
import * as dogRepo from '@/db/dogRepo';
import { useAppStore } from '@/store/appStore';

/**
 * First-run onboarding. Deliberately minimal: name only (plus optional age).
 * Everything else — breed, vet numbers, emergency plan — is added later from
 * Home, because a new user in distress should reach a working timer fast.
 */
export default function OnboardingScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const refreshDogs = useAppStore((s) => s.refreshDogs);
  const setActiveDog = useAppStore((s) => s.setActiveDog);

  const [name, setName] = useState('');
  const [age, setAge] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError('Please enter your dog\u2019s name.');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const parsedAge = age.trim() ? Number(age) : null;
      const id = await dogRepo.createDog({
        name: trimmed,
        ageYears: Number.isFinite(parsedAge) ? parsedAge : null,
      });
      await refreshDogs();
      await setActiveDog(id);
      router.replace('/(tabs)');
    } catch (e) {
      console.error('[onboarding] create failed', e);
      setError('Could not save the profile. Please try again.');
      setSaving(false);
    }
  };

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.xl }]}
      keyboardShouldPersistTaps="handled"
    >
      <View style={styles.logo}><Body style={styles.logoMark}>🐾</Body></View>
      <Title>Paws Journal</Title>
      <Muted style={styles.intro}>
        A calm place to record and understand your dog&apos;s seizures — built to be
        fast in the moment, and useful when you talk to your vet.
      </Muted>

      <Disclaimer>
        This app helps you record and organize information for your dog&apos;s care.
        It does not diagnose or treat seizures. If your dog is having a
        prolonged or repeated seizure, follow your veterinarian&apos;s emergency plan
        and seek veterinary care.
      </Disclaimer>

      <Card style={{ marginTop: spacing.lg }}>
        <Heading>Let&apos;s set up your dog&apos;s profile</Heading>

        <Muted style={styles.label}>DOG&apos;S NAME</Muted>
        <TextInput
          style={styles.input}
          value={name}
          onChangeText={setName}
          placeholder="e.g. Biscuit"
          placeholderTextColor={colors.inkSoft}
          returnKeyType="next"
          accessibilityLabel="Dog's name"
        />

        <Muted style={styles.label}>APPROXIMATE AGE (YEARS, OPTIONAL)</Muted>
        <TextInput
          style={styles.input}
          value={age}
          onChangeText={setAge}
          keyboardType="decimal-pad"
          placeholder="e.g. 4"
          placeholderTextColor={colors.inkSoft}
          accessibilityLabel="Approximate age in years, optional"
        />

        <Muted style={{ marginBottom: spacing.md }}>
          You can choose a breed from the standardized list right after creating
          the profile.
        </Muted>

        {error ? <Body style={styles.error}>{error}</Body> : null}

        <Button label="Create profile" large loading={saving} onPress={onSubmit} />
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  logo: {
    width: 56, height: 56, borderRadius: 16, backgroundColor: colors.teal,
    alignItems: 'center', justifyContent: 'center', marginBottom: spacing.md,
  },
  logoMark: { fontSize: 26 },
  intro: { fontSize: fontSize.base, lineHeight: 22, marginVertical: spacing.md },
  label: {
    fontSize: fontSize.xs, fontWeight: '700', letterSpacing: 0.8,
    marginTop: spacing.md, marginBottom: 6,
  },
  input: {
    borderWidth: 1, borderColor: colors.line, borderRadius: radius.sm,
    paddingHorizontal: spacing.md, minHeight: 48, fontSize: fontSize.md,
    color: colors.ink, backgroundColor: colors.card,
  },
  error: { color: colors.redDeep, marginBottom: spacing.sm },
});
