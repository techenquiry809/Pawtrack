import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Body, Button, Card, Disclaimer, Heading, Muted, Title } from '@/components/ui';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';
import { Icon } from '@/components/Icon';
import * as dogRepo from '@/db/dogRepo';
import { useAppStore } from '@/store/appStore';
import { BREED_LIST, BREED_SOURCE, SPECIAL_BREEDS, type BreedOption } from '@/constants/breeds';

/**
 * First-run onboarding.
 *
 * Name is the only required field. Breed sits here now rather than after
 * creation, but is OPTIONAL and never blocks the profile — a new owner in
 * distress must reach a working timer fast, and pedigree can wait.
 *
 * Breed is chosen from the bundled standardized list through the full-screen
 * picker. There is deliberately NO free-text breed field: free text produces
 * "Golden Retreiver", "golden retriver" and "Golder Retriever" as three
 * different dogs and makes the records ungroupable. The only free text is the
 * optional description that pairs with Mixed Breed or Other, stored in a
 * separate column.
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

  // The picker hands its choice back through the route, so this screen never
  // needs to hold a copy of the breed list.
  const params = useLocalSearchParams<{ breedId?: string; breedDesc?: string }>();
  const chosenBreed: BreedOption | undefined = params.breedId
    ? [...SPECIAL_BREEDS, ...BREED_LIST].find((b) => b.breedId === params.breedId)
    : undefined;
  const breedDesc = (params.breedDesc ?? '').slice(0, 200);

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
        breed: chosenBreed
          ? {
              breedId: chosenBreed.breedId,
              // The canonical stored name, never the friendlier picker label.
              breedName: chosenBreed.breedName,
              breedSource: BREED_SOURCE,
              userEnteredDescription:
                chosenBreed.kind === 'mixed' || chosenBreed.kind === 'other'
                  ? breedDesc
                  : '',
            }
          : undefined,
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

        <Muted style={styles.label}>BREED (OPTIONAL)</Muted>
        <Pressable
          onPress={() =>
            router.push('/breed-picker?returnTo=onboarding')
          }
          accessibilityRole="button"
          accessibilityLabel="Choose Breed"
          accessibilityHint="Opens a searchable list of standardized breeds"
          style={({ pressed }) => [styles.breedBtn, pressed && styles.pressed]}
        >
          <View style={styles.flexOne}>
            <Text style={styles.breedValue}>
              {chosenBreed
                ? chosenBreed.pickerLabel ?? chosenBreed.breedName
                : 'Choose Breed'}
            </Text>
            {chosenBreed && breedDesc.length > 0 && (
              <Text style={styles.breedDesc} numberOfLines={1}>
                {breedDesc}
              </Text>
            )}
          </View>
          <Icon name="chevron" size="md" color={colors.inkSoft} />
        </Pressable>
        <Muted style={{ marginTop: 6, marginBottom: spacing.md }}>
          You can skip this and set it later from the dog profile.
        </Muted>

        {error ? <Body style={styles.error}>{error}</Body> : null}

        <Button
          label="Create profile"
          large
          loading={saving}
          // Disabled until there is a name — the one genuinely required field.
          disabled={name.trim().length === 0}
          onPress={onSubmit}
        />
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
  flexOne: { flex: 1 },
  pressed: { opacity: 0.7 },
  breedBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: 48,
    backgroundColor: colors.card,
  },
  breedValue: { fontSize: fontSize.md, color: colors.ink, fontWeight: '600' },
  breedDesc: { fontSize: fontSize.sm, color: colors.inkSoft, marginTop: 1 },
});
