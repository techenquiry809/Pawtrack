/**
 * A video, as a tappable tile.
 *
 * Used by the gallery grid and by the import screen's "picked so far" strip,
 * which is why it takes plain props rather than a GalleryEntry.
 *
 * ── THE PLACEHOLDER IS NOT AN EDGE CASE ───────────────────────────────
 *
 * Thumbnail extraction is best-effort (see videoService.generateThumbnail) and
 * fails routinely on very short clips — which describes a lot of seizure
 * footage. A missing poster frame is normal, so the empty state is designed
 * rather than left as a grey box: it keeps the duration and the badge, so the
 * tile still tells you what it is.
 */

import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, fontSize, radius, spacing } from '@/theme/tokens';
import { thumbnailUri } from '@/services/videoService';
import { formatDuration } from '@/utils/time';
import type { CaptureConfidence } from '@/types/domain';

export type VideoTileProps = {
  thumbUri: string;
  durationSec: number | null;
  /** Rendered bottom-left. Usually the time of day. */
  caption?: string;
  /**
   * Shown when the timestamp is not something the app measured. Absent for a
   * live capture — a badge on every tile is a badge on none.
   */
  captureConfidence?: CaptureConfidence;
  onPress?: () => void;
  onLongPress?: () => void;
  accessibilityLabel: string;
  /** Square by default; the import strip uses a shorter tile. */
  aspect?: number;
};

export function VideoTile({
  thumbUri,
  durationSec,
  caption,
  captureConfidence,
  onPress,
  onLongPress,
  accessibilityLabel,
  aspect = 1,
}: VideoTileProps) {
  const uri = thumbUri ? thumbnailUri(thumbUri) : '';
  const stated = captureConfidence === 'owner_stated';
  const unknown = captureConfidence === 'unknown';

  const body = (
    <View style={[styles.tile, { aspectRatio: aspect }]}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View style={[styles.thumb, styles.placeholder]}>
          <Icon name="camera" size="lg" color={colors.inkSoft} />
        </View>
      )}

      {/* A scrim, not a solid bar: the caption has to stay legible over a
          frame that might be a bright kitchen floor or a dark bedroom. */}
      <View style={styles.scrim} pointerEvents="none" />

      {durationSec !== null && durationSec > 0 ? (
        <View style={[styles.badge, styles.badgeTopRight]}>
          <Text style={styles.badgeText}>{formatDuration(durationSec)}</Text>
        </View>
      ) : null}

      {stated || unknown ? (
        <View style={[styles.badge, styles.badgeTopLeft, styles.badgeStated]}>
          <Text style={[styles.badgeText, styles.badgeStatedText]}>
            {unknown ? 'No date' : 'Your date'}
          </Text>
        </View>
      ) : null}

      {caption ? (
        <Text style={styles.caption} numberOfLines={1}>
          {caption}
        </Text>
      ) : null}
    </View>
  );

  if (!onPress && !onLongPress) return body;

  return (
    <Pressable
      onPress={onPress}
      onLongPress={onLongPress}
      accessibilityRole="imagebutton"
      accessibilityLabel={accessibilityLabel}
      style={({ pressed }) => [styles.pressable, pressed && { opacity: 0.75 }]}
    >
      {body}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  pressable: { flex: 1 },
  tile: {
    flex: 1,
    borderRadius: radius.sm,
    overflow: 'hidden',
    backgroundColor: colors.line,
    borderWidth: 1,
    borderColor: colors.line,
  },
  // Not StyleSheet.absoluteFillObject: React Native 0.86's types no longer
  // expose it as a spreadable object. Written out, it is also clearer.
  thumb: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },
  placeholder: {
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.bg,
  },
  scrim: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    height: '46%',
    backgroundColor: 'rgba(32,41,58,0.42)',
  },
  badge: {
    position: 'absolute',
    paddingHorizontal: 7,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: 'rgba(32,41,58,0.72)',
  },
  badgeTopRight: { top: spacing.xs + 2, right: spacing.xs + 2 },
  badgeTopLeft: { top: spacing.xs + 2, left: spacing.xs + 2 },
  badgeStated: { backgroundColor: colors.amberTint },
  badgeText: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    color: colors.onMedia,
    fontVariant: ['tabular-nums'],
  },
  badgeStatedText: { color: colors.amberInk },
  caption: {
    position: 'absolute',
    left: spacing.sm,
    right: spacing.sm,
    bottom: spacing.sm - 2,
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.onMedia,
    fontVariant: ['tabular-nums'],
  },
});
