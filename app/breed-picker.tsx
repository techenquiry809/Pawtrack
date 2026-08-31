
/**
 * Standardized breed selection.
 *
 * This exists to stop free-text breed entry polluting the dataset with
 * spelling variants — but breed is not a cosmetic field here. Median age of
 * onset for canine idiopathic epilepsy is around 2.5 years and predisposition
 * is documented for specific breeds, so this value lands on a vet report next
 * to a date of birth and a seizure history.
 *
 * ── LAYOUT DECISIONS ──────────────────────────────────────────────────
 *
 * The search field is deliberately NOT first, and is NOT autofocused. With 235
 * rows the instinct is search-first, but raising the keyboard on mount hides
 * two-thirds of the screen and forces typing on someone who may be holding a
 * dog with one hand. Order is: pinned answers, quick picks, then search.
 *
 * "I don't know" is a first-class answer with the same visual weight as
 * Labrador Retriever, not a failure state buried at the bottom. An owner who
 * has just watched their dog seize must never be blocked by a question about
 * pedigree.
 *
 * ── WHAT IS DELIBERATELY ABSENT ───────────────────────────────────────
 *
 * Nothing on this screen indicates that a breed is predisposed to epilepsy,
 * even though src/constants/breeds.ts holds that data. Badging "epilepsy-prone"
 * beside Beagle during onboarding alarms an owner who has no diagnosis, and
 * edges the app toward implying one. The data earns its keep silently, by
 * ordering the quick picks.
 */

import { useMemo, useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Body, Button, Heading, Muted, Title } from '@/components/ui';
import { colors, fontFamily, fontSize, MIN_TOUCH_TARGET, radius, spacing } from '@/theme/tokens';
import { goBackOrHome } from '@/utils/nav';
import { BackButton } from '@/components/BackButton';
import { useActiveDog, useAppStore } from '@/store/appStore';
import * as dogRepo from '@/db/dogRepo';
import { Icon } from '@/components/Icon';
import {
  BREED_LIST,
  BREED_SOURCE,
  SPECIAL_BREEDS,
  quickPicks,
  searchBreeds,
  type BreedOption,
} from '@/constants/breeds';

/** Fixed so getItemLayout can skip measurement — see the FlatList below. */
const ROW_HEIGHT = 56;
const DESCRIPTION_LIMIT = 200;

const labelFor = (b: BreedOption): string => b.pickerLabel ?? b.breedName;

export default function BreedPickerScreen() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const dog = useActiveDog();
  const refreshDogs = useAppStore((s) => s.refreshDogs);

  // Onboarding opens this BEFORE a dog row exists, so there is nothing to
  // update — the choice is handed back through the route instead.
  const { returnTo } = useLocalSearchParams<{ returnTo?: string }>();
  const isOnboarding = returnTo === 'onboarding';

  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<BreedOption | null>(null);
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const listRef = useRef<FlatList<BreedOption>>(null);

  const searching = query.trim().length > 0;
  const results = useMemo(
    () => (searching ? searchBreeds(query) : BREED_LIST),
    [query, searching],
  );
  const picks = useMemo(() => quickPicks(), []);

  // During onboarding there is no dog yet; every other entry point requires one.
  if (!dog && !isOnboarding) return null;

  // Only these two kinds pair with the owner's own words. For a standard breed
  // the canonical name IS the answer, and a free-text box would invite exactly
  // the spelling drift this screen exists to prevent.
  const needsDescription = selected?.kind === 'mixed' || selected?.kind === 'other';

  const onSave = async () => {
    if (!selected) return;

    if (isOnboarding) {
      // Hand the structured choice back. The description travels separately so
      // the two never merge into one free-text field.
      router.replace({
        pathname: '/onboarding',
        params: {
          breedId: selected.breedId,
          breedDesc: needsDescription
            ? description.trim().slice(0, DESCRIPTION_LIMIT)
            : '',
        },
      });
      return;
    }

    if (!dog) return;
    setSaving(true);
    setError(null);
    try {
      await dogRepo.updateDog(dog.id, {
        breed: {
          breedId: selected.breedId,
          // The canonical stored name, never the friendlier picker label.
          breedName: selected.breedName,
          breedSource: BREED_SOURCE,
          userEnteredDescription: needsDescription
            ? description.trim().slice(0, DESCRIPTION_LIMIT)
            : '',
        },
      });
      await refreshDogs();
      goBackOrHome(router);
    } catch (e) {
      console.error('[breed-picker] save failed', e);
      setError('Could not save the breed. Please try again.');
      setSaving(false);
    }
  };

  const renderRow = ({ item }: { item: BreedOption }) => {
    const isSelected = selected?.breedId === item.breedId;
    return (
      <Pressable
        onPress={() => {
          setSelected(item);
          if (item.kind !== 'mixed' && item.kind !== 'other') setDescription('');
        }}
        accessibilityRole="radio"
        accessibilityState={{ selected: isSelected }}
        accessibilityLabel={labelFor(item)}
        style={({ pressed }) => [
          styles.row,
          isSelected && styles.rowOn,
          pressed && styles.pressed,
        ]}
      >
        <Body style={[styles.rowLabel, isSelected && styles.rowLabelOn]}>
          {labelFor(item)}
        </Body>
        {/* A tick as well as colour — never colour alone. */}
        {isSelected ? <Text style={styles.tick}>✓</Text> : null}
      </Pressable>
    );
  };

  return (
    <View style={[styles.screen, { paddingTop: insets.top + spacing.md }]}>
      <View style={styles.header}>
        <BackButton />
        <Title>Choose breed</Title>
        <Muted style={styles.intro}>
          Picking from the list keeps {dog ? `${dog.name}'s` : 'your'} records
          groupable. If you are not sure, say so — it is a real answer, not a gap.
        </Muted>
      </View>

      <FlatList
        ref={listRef}
        data={results}
        keyExtractor={(item) => item.breedId}
        renderItem={renderRow}
        keyboardShouldPersistTaps="handled"
        // 235 fixed-height rows. Without this the list measures every row on
        // mount and scrolling stutters on older Android hardware.
        getItemLayout={(_, index) => ({
          length: ROW_HEIGHT,
          offset: ROW_HEIGHT * index,
          index,
        })}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          <View>
            {/* ── The search field ──────────────────────────────────────
                Now at the TOP, with a glyph, because a bare bordered box two
                sections down does not read as search — owners scrolled past it
                to hunt the alphabetical list by hand. It is still NOT
                autofocused: raising the keyboard on mount hides the pinned
                answers, which are the right answer for a rescue or a cross. */}
            <View style={styles.searchWrap}>
              <Icon name="search" size="md" color={colors.inkSoft} />
              <TextInput
                style={styles.search}
                value={query}
                onChangeText={(next) => {
                  setQuery(next);
                  listRef.current?.scrollToOffset({ offset: 0, animated: false });
                }}
                placeholder={`Search ${BREED_LIST.length} breeds`}
                placeholderTextColor={colors.inkSoft}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                accessibilityLabel="Search breeds"
              />
              {searching ? (
                <Pressable
                  onPress={() => {
                    setQuery('');
                    listRef.current?.scrollToOffset({ offset: 0, animated: false });
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Clear search"
                  hitSlop={10}
                  style={({ pressed }) => pressed && styles.pressed}
                >
                  <Icon name="clear" size="md" color={colors.inkSoft} />
                </Pressable>
              ) : null}
            </View>

            {/* Pinned answers. Not buried under 235 alphabetical entries. */}
            {!searching && (
              <>
                <Text style={styles.sectionLabel}>IF YOU ARE NOT SURE</Text>
                {SPECIAL_BREEDS.map((item) => (
                  <View key={item.breedId}>{renderRow({ item })}</View>
                ))}

                <Text style={styles.sectionLabel}>COMMON</Text>
                {picks.map((item) => (
                  <View key={item.breedId}>{renderRow({ item })}</View>
                ))}
              </>
            )}

            <Text style={styles.sectionLabel}>
              {searching
                ? `${results.length} RESULT${results.length === 1 ? '' : 'S'}`
                : 'ALL BREEDS'}
            </Text>
          </View>
        }
        ListEmptyComponent={
          // The pinned answers are hidden while searching, so a query that
          // matches nothing would otherwise leave an empty screen telling the
          // owner to pick something that is not on it. Render them here.
          <View style={styles.empty}>
            <Muted style={{ marginBottom: spacing.md }}>
              No breed matches “{query.trim()}”. That is common with rescues and
              crosses — one of these is a real answer:
            </Muted>
            {SPECIAL_BREEDS.map((item) => (
              <View key={item.breedId}>{renderRow({ item })}</View>
            ))}
          </View>
        }
      />

      {/* --- Confirmation bar ----------------------------------------- */}
      {selected && (
        <View style={[styles.footer, { paddingBottom: insets.bottom + spacing.md }]}>
          <Heading>{labelFor(selected)}</Heading>

          {needsDescription && (
            <>
              <Muted style={styles.footerHint}>
                {selected.kind === 'mixed'
                  ? 'What is in the mix, as far as you know? Optional.'
                  : "What breed is it? We'll store your wording."}
              </Muted>
              <TextInput
                style={styles.descriptionInput}
                value={description}
                onChangeText={setDescription}
                maxLength={DESCRIPTION_LIMIT}
                placeholder="e.g. collie and something bigger"
                placeholderTextColor={colors.inkSoft}
                accessibilityLabel="Breed description in your own words"
              />
            </>
          )}

          {error ? <Body style={styles.error}>{error}</Body> : null}

          <Button
            label="Save breed"
            large
            loading={saving}
            onPress={() => void onSave()}
            style={{ marginTop: spacing.sm }}
          />
          <Muted style={styles.provenance}>
            Names follow a standardized list ({BREED_LIST.length} breeds,{' '}
            {BREED_SOURCE}).
          </Muted>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { paddingHorizontal: spacing.lg },
  intro: { marginTop: spacing.sm, marginBottom: spacing.sm },
  listContent: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },

  sectionLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.inkSoft,
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
    fontFamily: fontFamily.bold
  },

  searchWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    marginBottom: spacing.md,
  },
  search: {
    flex: 1,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: fontSize.md,
    fontWeight: '600',
    color: colors.ink,
    fontFamily: fontFamily.semibold
  },

  row: {
    height: ROW_HEIGHT,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: spacing.md,
    marginBottom: 6,
    borderRadius: radius.card,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.line,
  },
  rowOn: { backgroundColor: colors.teal, borderColor: colors.teal },
  rowLabel: { fontWeight: '600', fontFamily: fontFamily.semibold },
  rowLabelOn: { color: '#fff' },
  tick: { color: '#fff', fontSize: fontSize.md, fontWeight: '700', fontFamily: fontFamily.bold },
  pressed: { opacity: 0.75 },

  empty: { paddingVertical: spacing.lg },

  footer: {
    borderTopWidth: 1,
    borderTopColor: colors.line,
    backgroundColor: colors.card,
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.md,
  },
  footerHint: { marginTop: 4 },
  descriptionInput: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
    minHeight: MIN_TOUCH_TARGET,
    fontSize: fontSize.md,
    color: colors.ink,
    marginTop: spacing.sm,
    fontFamily: fontFamily.regular
  },
  error: { color: colors.redDeep, marginTop: spacing.sm },
  provenance: { textAlign: 'center', marginTop: spacing.sm },
});
