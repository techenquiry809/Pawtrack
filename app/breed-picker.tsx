import { Placeholder } from '@/components/Placeholder';

/**
 * Standardized breed selection. This exists specifically to stop free-text
 * breed entry polluting the dataset with spelling variants.
 */
export default function BreedPickerScreen() {
  return (
    <Placeholder
      title="Choose breed"
      summary="Searchable list of 235 standardized breeds, plus Mixed Breed, Unknown and Other. Selection writes a structured Breed object, never raw text."
      todo={[
        'Import BREED_LIST from src/constants/breeds.ts',
        'Case-insensitive substring search input',
        'FlatList of matches; tapping one saves via dogRepo.updateDog',
        'Mixed Breed / Other reveal a free-text description field stored in userEnteredDescription',
      ]}
    />
  );
}
