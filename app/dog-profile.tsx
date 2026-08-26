/**
 * Dog profile — photo and the details a veterinarian asks for.
 *
 * These fields already existed in DogSchema but had no editor, so they were
 * unreachable: sex, weight, date of birth, diagnosis status, first seizure
 * date, seizure type, allergies, diet.
 *
 * ── SAFETY ────────────────────────────────────────────────────────────
 *
 * Diagnosis status is what the owner's VET has told them, not something the
 * app works out. "Suspected" and "Diagnosed" are recorded, never inferred from
 * seizure count — inferring one would be the app diagnosing a dog.
 *
 * Every field is optional. A half-filled profile is more useful than one the
 * owner abandoned because a field demanded precision they did not have.
 */

import { useCallback, useState } from 'react';
import {
  ActionSheetIOS, Alert, Platform, Pressable, ScrollView, StyleSheet, Text,
  TextInput, View,
} from 'react-native';
import { useFocusEffect, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body, Button, Card, Heading, Muted, SegmentedControl, Title,
} from '@/components/ui';
import { DogAvatar } from '@/components/ProfileHeader';
import { colors, fontSize, radius, spacing, MIN_TOUCH_TARGET } from '@/theme/tokens';
import { goBackOrHome } from '@/utils/nav';
import { Icon } from '@/components/Icon';
import { useActiveDog, useAppStore } from '@/store/appStore';
import * as dogRepo from '@/db/dogRepo';
import { breedDisplay } from '@/db/dogRepo';
import { deleteDogPhoto, pickDogPhoto, takeDogPhoto } from '@/services/dogPhotoService';
import { DIAGNOSIS_STATUSES, type DiagnosisStatus, type Dog } from '@/types/domain';

const DIAGNOSIS_LABEL: Record<DiagnosisStatus, string> = {
  undiagnosed: 'Not diagnosed',
  suspected: 'Suspected',
  diagnosed: 'Diagnosed',
};

export default function DogProfileScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dog = useActiveDog();
  const refreshDogs = useAppStore((s) => s.refreshDogs);

  const [photoUri, setPhotoUri] = useState('');
  const [name, setName] = useState('');
  const [sex, setSex] = useState<Dog['sex']>('');
  const [ageYears, setAgeYears] = useState('');
  const [weightKg, setWeightKg] = useState('');
  const [dob, setDob] = useState('');
  const [diagnosisStatus, setDiagnosisStatus] = useState<DiagnosisStatus>('undiagnosed');
  const [firstSeizureDate, setFirstSeizureDate] = useState('');
  const [seizureType, setSeizureType] = useState('');
  const [allergies, setAllergies] = useState('');
  const [diet, setDiet] = useState('');

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useFocusEffect(
    useCallback(() => {
      if (!dog) return;
      setPhotoUri(dog.photoUri);
      setName(dog.name);
      setSex(dog.sex);
      setAgeYears(dog.ageYears === null ? '' : String(dog.ageYears));
      setWeightKg(dog.weightKg === null ? '' : String(dog.weightKg));
      setDob(dog.dob);
      setDiagnosisStatus(dog.diagnosisStatus);
      setFirstSeizureDate(dog.firstSeizureDate);
      setSeizureType(dog.seizureType);
      setAllergies(dog.allergies);
      setDiet(dog.diet);
    }, [dog]),
  );

  if (!dog) return null;

  const applyPhoto = async (pick: () => Promise<string | null>) => {
    try {
      const next = await pick();
      if (!next) return;
      const previous = photoUri;
      setPhotoUri(next);
      await dogRepo.updateDog(dog.id, { photoUri: next });
      await refreshDogs();
      // Only after the new one is safely stored.
      if (previous && previous !== next) deleteDogPhoto(previous);
    } catch (e) {
      Alert.alert(
        'Could not add the photo',
        e instanceof Error ? e.message : 'Please try again.',
      );
    }
  };

  const onChangePhoto = () => {
    const options = photoUri
      ? ['Take a photo', 'Choose from library', 'Remove photo', 'Cancel']
      : ['Take a photo', 'Choose from library', 'Cancel'];
    const cancelIndex = options.length - 1;
    const destructiveIndex = photoUri ? 2 : undefined;

    const handle = (index: number) => {
      if (index === 0) void applyPhoto(takeDogPhoto);
      else if (index === 1) void applyPhoto(pickDogPhoto);
      else if (photoUri && index === 2) {
        void (async () => {
          const previous = photoUri;
          setPhotoUri('');
          await dogRepo.updateDog(dog.id, { photoUri: '' });
          await refreshDogs();
          deleteDogPhoto(previous);
        })();
      }
    };

    if (Platform.OS === 'ios') {
      ActionSheetIOS.showActionSheetWithOptions(
        { options, cancelButtonIndex: cancelIndex, destructiveButtonIndex: destructiveIndex },
        handle,
      );
      return;
    }
    Alert.alert('Dog photo', undefined, [
      { text: 'Take a photo', onPress: () => handle(0) },
      { text: 'Choose from library', onPress: () => handle(1) },
      ...(photoUri
        ? [{ text: 'Remove photo', style: 'destructive' as const, onPress: () => handle(2) }]
        : []),
      { text: 'Cancel', style: 'cancel' as const },
    ]);
  };

  const onSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError("Please enter your dog's name.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      const age = ageYears.trim() ? Number(ageYears) : null;
      const weight = weightKg.trim() ? Number(weightKg) : null;
      await dogRepo.updateDog(dog.id, {
        name: trimmed,
        sex,
        ageYears: Number.isFinite(age) ? age : null,
        weightKg: Number.isFinite(weight) ? weight : null,
        dob: dob.trim(),
        diagnosisStatus,
        firstSeizureDate: firstSeizureDate.trim(),
        seizureType: seizureType.trim(),
        allergies: allergies.trim(),
        diet: diet.trim(),
      });
      await refreshDogs();
      goBackOrHome(router);
    } catch (e) {
      console.error('[dog-profile] save failed', e);
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
      <Title>Profile</Title>

      {/* --- Photo --------------------------------------------------- */}
      <View style={styles.photoBlock}>
        <Pressable
          onPress={onChangePhoto}
          accessibilityRole="button"
          accessibilityLabel={photoUri ? "Change your dog's photo" : "Add a photo of your dog"}
          style={({ pressed }) => [styles.photoTap, pressed && styles.pressed]}
        >
          <DogAvatar photoUri={photoUri} size={104} />
          <View style={styles.photoBadge}>
            <Icon name={photoUri ? 'edit' : 'add'} size="md" color="#fff" />
          </View>
        </Pressable>
        <Body style={styles.photoLabel}>
          {photoUri ? 'Tap to change photo' : 'Add a photo'}
        </Body>
      </View>

      {/* --- Identity ------------------------------------------------ */}
      <Card>
        <Heading>About {dog.name}</Heading>
        <Field label="NAME" value={name} onChangeText={setName} />

        <Muted style={styles.fieldLabel}>BREED</Muted>
        <Pressable
          onPress={() => router.push('/breed-picker')}
          accessibilityRole="button"
          accessibilityLabel="Choose Breed"
          style={({ pressed }) => [styles.linkRow, pressed && styles.pressed]}
        >
          <Text style={styles.linkValue}>{breedDisplay(dog)}</Text>
          <Icon name="chevron" size="md" color={colors.inkSoft} />
        </Pressable>

        <Muted style={styles.fieldLabel}>SEX</Muted>
        <SegmentedControl<'' | 'male' | 'female'>
          accessibilityLabel="Sex"
          value={sex}
          onChange={setSex}
          options={[
            { value: '', label: 'Not set' },
            { value: 'male', label: 'Male' },
            { value: 'female', label: 'Female' },
          ]}
        />

        <View style={styles.pairRow}>
          <View style={styles.flexOne}>
            <Field label="AGE (YEARS)" value={ageYears} onChangeText={setAgeYears} numeric />
          </View>
          <View style={styles.flexOne}>
            <Field label="WEIGHT (KG)" value={weightKg} onChangeText={setWeightKg} numeric />
          </View>
        </View>

        <Field label="DATE OF BIRTH" value={dob} onChangeText={setDob} placeholder="YYYY-MM-DD" />
      </Card>

      {/* --- Seizure history ----------------------------------------- */}
      <Card>
        <Heading>Seizure history</Heading>
        <Muted style={{ marginTop: 4 }}>
          What your veterinarian has told you. The app never works this out from
          your records.
        </Muted>

        <Muted style={styles.fieldLabel}>DIAGNOSIS</Muted>
        <SegmentedControl<DiagnosisStatus>
          accessibilityLabel="Diagnosis status"
          value={diagnosisStatus}
          onChange={setDiagnosisStatus}
          options={DIAGNOSIS_STATUSES.map((s) => ({ value: s, label: DIAGNOSIS_LABEL[s] }))}
        />

        <Field
          label="FIRST SEIZURE"
          value={firstSeizureDate}
          onChangeText={setFirstSeizureDate}
          placeholder="YYYY-MM-DD"
        />
        <Field label="SEIZURE TYPE" value={seizureType} onChangeText={setSeizureType} />
      </Card>

      {/* --- Care ---------------------------------------------------- */}
      <Card>
        <Heading>Care</Heading>
        <Field label="ALLERGIES" value={allergies} onChangeText={setAllergies} multiline />
        <Field label="DIET" value={diet} onChangeText={setDiet} multiline />
      </Card>

      {error ? <Body style={styles.error}>{error}</Body> : null}

      <Button label="Save profile" large loading={saving} onPress={() => void onSave()} />
    </ScrollView>
  );
}

function Field({
  label,
  value,
  onChangeText,
  placeholder,
  numeric = false,
  multiline = false,
}: {
  label: string;
  value: string;
  onChangeText: (t: string) => void;
  placeholder?: string;
  numeric?: boolean;
  multiline?: boolean;
}) {
  return (
    <View>
      <Muted style={styles.fieldLabel}>{label}</Muted>
      <TextInput
        style={[styles.input, multiline && styles.inputTall]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={colors.inkSoft}
        keyboardType={numeric ? 'decimal-pad' : 'default'}
        multiline={multiline}
        accessibilityLabel={label.toLowerCase()}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  flexOne: { flex: 1 },
  pressed: { opacity: 0.75 },

  photoBlock: { alignItems: 'center', marginVertical: spacing.lg },
  photoTap: { position: 'relative' },
  photoBadge: {
    position: 'absolute',
    right: -2,
    bottom: -2,
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.teal,
    borderWidth: 3,
    borderColor: colors.bg,
  },
  photoLabel: { marginTop: spacing.sm, color: colors.inkSoft },

  fieldLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 0.8,
    marginTop: spacing.md,
    marginBottom: 6,
  },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: fontSize.md,
    color: colors.ink,
    backgroundColor: colors.bg,
  },
  inputTall: { minHeight: 76, paddingTop: spacing.md, textAlignVertical: 'top' },

  pairRow: { flexDirection: 'row', gap: spacing.md },

  linkRow: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    backgroundColor: colors.bg,
  },
  linkValue: { flex: 1, fontSize: fontSize.md, color: colors.ink, fontWeight: '600' },

  error: { color: colors.redDeep, marginBottom: spacing.sm },
});
