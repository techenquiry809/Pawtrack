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
 *
 * ── AND NEITHER IS A VIDEO THAT LIVES ON ANOTHER PHONE ────────────────
 *
 * Seizure video files never leave the device that recorded them. The video ROW
 * syncs, because "a recording exists for this seizure" is clinically
 * meaningful — a vet report saying so is useful even where the file is not.
 * The bytes do not, because a path from another device resolves to nothing
 * here.
 *
 * So on a second device this tile has real content to show and no frames to
 * show it with. That gets a DESIGNED state, not a broken image and not a
 * hidden tile: hiding it would misrepresent the record, and a broken tile
 * reads as a bug the owner will worry about. It names the phone that has the
 * clip so there is something to act on.
 */

import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';
import { thumbnailUri } from '@/services/videoService';
import { formatDuration } from '@/utils/time';
import type { CaptureConfidence } from '@/types/domain';

export type VideoTileProps = {
  thumbUri: string;
  durationSec: number | null;
  /**
   * False when the bytes are on another device. Defaults to true so the
   * gallery's existing call sites and the import strip — where the file is by
   * definition local — are unaffected.
   */
  isLocal?: boolean;
  /**
   * The phone that recorded it, for the remote state's caption. Falls back to
   * "another device" when the device registry has not been read yet or the
   * clip predates device tracking.
   */
  originDeviceName?: string | null;
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
  isLocal = true,
  originDeviceName,
  caption,
  captureConfidence,
  onPress,
  onLongPress,
  accessibilityLabel,
  aspect = 1,
}: VideoTileProps) {
  // A remote clip has no poster frame here either — the thumbnail is extracted
  // from the bytes, so it lives with them.
  const uri = isLocal && thumbUri ? thumbnailUri(thumbUri) : '';
  const stated = captureConfidence === 'owner_stated';
  const unknown = captureConfidence === 'unknown';

  const body = (
    <View style={[styles.tile, { aspectRatio: aspect }]}>
      {uri ? (
        <Image source={{ uri }} style={styles.thumb} resizeMode="cover" />
      ) : (
        <View
          style={[
            styles.thumb,
            styles.placeholder,
            !isLocal && styles.placeholderRemote,
          ]}
        >
          <Icon
            name={isLocal ? 'camera' : 'device'}
            size="lg"
            color={isLocal ? colors.inkSoft : colors.tealDeep}
          />
          {!isLocal && (
            <Text style={styles.remoteLabel} numberOfLines={2}>
              On {originDeviceName ?? 'another device'}
            </Text>
          )}
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
    borderRadius: radius.card,
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
  /**
   * Tinted rather than grey. The point of this state is that nothing is wrong
   * — the record is complete and the clip is simply somewhere else — so it has
   * to read as a deliberate surface, not as a failed load.
   */
  placeholderRemote: {
    backgroundColor: colors.tealTint,
    gap: spacing.xs,
    paddingHorizontal: spacing.sm,
  },
  remoteLabel: {
    fontSize: fontSize.xs,
    fontWeight: '700',
    color: colors.tealDeep,
    textAlign: 'center',
    fontFamily: fontFamily.bold
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
    fontFamily: fontFamily.extrabold
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
    fontFamily: fontFamily.bold
  },
});
