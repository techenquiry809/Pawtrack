/**
 * The profile header from the reference design: a greeting on the left, a
 * circular avatar on the right, the whole row tapping through to the profile.
 *
 * PALETTE IS UNCHANGED — this is the app's existing cream/white/ink/teal token
 * set, not the reference's blues. Only the arrangement is borrowed.
 *
 * The avatar falls back to a paw glyph on the brand teal rather than to an
 * empty circle, so a dog with no photo still reads as a dog rather than as a
 * broken image.
 */

import { useEffect, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';
import { colors, fontSize, radius, shadow, spacing } from '@/theme/tokens';
import { breedDisplay } from '@/db/dogRepo';
import { dogPhotoUri } from '@/services/dogPhotoService';
import { Icon } from '@/components/Icon';
import type { Dog } from '@/types/domain';

/**
 * `photoUri` is the RELATIVE path stored in the database; it is resolved
 * against the current document directory here. See src/services/fileStore.ts
 * for why an absolute path must never be persisted.
 *
 * If the image fails to load — a file deleted outside the app, or a legacy row
 * still pointing at a dead container — we fall back to the paw rather than
 * leaving an empty circle. A blank avatar reads as a rendering bug; the paw
 * reads as "no photo yet", which is the truth.
 */
export function DogAvatar({
  photoUri,
  size = 52,
}: {
  photoUri: string;
  size?: number;
}) {
  const [failed, setFailed] = useState(false);
  const resolved = dogPhotoUri(photoUri);

  // A new photo must clear a previous failure, or the fallback sticks.
  useEffect(() => setFailed(false), [photoUri]);

  const style = { width: size, height: size, borderRadius: size / 2 };

  if (resolved && !failed) {
    return (
      <Image
        source={{ uri: resolved }}
        style={[styles.avatar, style]}
        onError={() => setFailed(true)}
        accessibilityIgnoresInvertColors
      />
    );
  }
  return (
    <View style={[styles.avatar, styles.avatarFallback, style]}>
      <Icon name="profile" size={size >= 80 ? 'xl' : 'lg'} color="#fff" filled />
    </View>
  );
}

export function ProfileHeader({
  dog,
  onPress,
}: {
  dog: Dog;
  onPress: () => void;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={`${dog.name}'s profile`}
      accessibilityHint="Opens the dog profile, where you can add a photo and details"
      style={({ pressed }) => [styles.header, pressed && styles.pressed]}
    >
      <View style={styles.headerText}>
        <Text style={styles.eyebrow}>PAWS JOURNAL</Text>
        <Text style={styles.name} numberOfLines={1}>
          {dog.name}
        </Text>
        <Text style={styles.sub} numberOfLines={1}>
          {breedDisplay(dog)}
        </Text>
      </View>
      <DogAvatar photoUri={dog.photoUri} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.md,
    padding: spacing.md,
    ...shadow.card,
  },
  pressed: { opacity: 0.85 },
  headerText: { flex: 1 },
  eyebrow: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    letterSpacing: 1.4,
    color: colors.inkSoft,
  },
  name: {
    fontSize: fontSize.lg,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -0.4,
    marginTop: 2,
  },
  sub: { fontSize: fontSize.sm, color: colors.inkSoft, marginTop: 1 },

  avatar: { backgroundColor: colors.tealTint },
  avatarFallback: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.teal,
  },
});
