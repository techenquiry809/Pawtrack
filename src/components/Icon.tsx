/**
 * The app's icon set.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * Every structural icon used to be an emoji: 🏠 in the tab bar, 📅 on a stat
 * card, 🚑 on a nav row. Emoji are font-dependent, render differently on every
 * OS version, cannot take a colour token, and cannot be sized consistently —
 * a 🌙 and a ⏱ do not share a baseline or an optical weight. They are the
 * single most common reason an app reads as unfinished.
 *
 * These are vector glyphs from Ionicons (bundled with Expo, no extra native
 * dependency), drawn at token sizes and coloured from the theme.
 *
 * ── DISCIPLINE ────────────────────────────────────────────────────────
 *
 * - ONE style per hierarchy level. Tab bar uses filled when active and outline
 *   when inactive, which is the platform convention; everything else is
 *   outline, so a filled glyph always means "selected".
 * - Sizes come from ICON_SIZE, never a literal. Mixing 20/24/28 arbitrarily is
 *   what makes spacing look accidental.
 * - Names are SEMANTIC (`icon="emergency"`), not visual (`icon="ambulance"`),
 *   so swapping the underlying glyph is a one-line change here rather than a
 *   hunt through screens.
 */

import { Ionicons } from '@expo/vector-icons';
import { colors } from '@/theme/tokens';

/** Size tokens. Use these, not literals. */
export const ICON_SIZE = {
  sm: 16,
  md: 20,
  lg: 24,
  xl: 28,
} as const;

export type IconSize = keyof typeof ICON_SIZE;

/**
 * Semantic name → glyph. Outline and filled variants are paired so the tab bar
 * can switch on focus without each caller knowing the Ionicons names.
 */
const GLYPHS = {
  home: ['home-outline', 'home'],
  checkin: ['create-outline', 'create'],
  records: ['document-text-outline', 'document-text'],
  more: ['ellipsis-horizontal', 'ellipsis-horizontal'],
  settings: ['settings-outline', 'settings'],
  // The universal record affordance: a ring with a filled dot. Same glyph
  // filled or not — a record button that changes shape on focus reads as a
  // state change, and this one is an action.
  record: ['radio-button-on', 'radio-button-on'],
  play: ['play', 'play'],
  search: ['search-outline', 'search'],
  clear: ['close-circle', 'close-circle'],
  // Something went wrong. Outline by default so it reads as information
  // rather than as an alarm — the emergency medkit glyph is reserved for the
  // cluster banner, which IS an alarm.
  warning: ['alert-circle-outline', 'alert-circle'],

  /*
   * The five steps of the energy scale.
   *
   * These used to be sad → happy smileys, which had two problems. Ionicons
   * ships only two face shapes, so the middle three were carried by fill and a
   * neutral dash — a scale of five where three steps were the same drawing.
   * And a smiley asks "what mood are you in", which is not the question: an
   * owner is not rating their dog's happiness, they are reporting how the
   * animal MOVED today, because that is the observation a vet can use.
   *
   * So the scale is now a dog's day, in the owner's own vocabulary:
   *
   *   flat out on the floor → mooching about → an ordinary day
   *   → up for a walk → zoomies
   *
   * Five genuinely distinct glyphs, all from Ionicons, all colourable and
   * sized from the same tokens as everything else — which is exactly why this
   * did not become emoji. See the note at the top of this file.
   */
  energy1: ['bed-outline', 'bed'],
  energy2: ['footsteps-outline', 'footsteps'],
  energy3: ['paw-outline', 'paw'],
  energy4: ['walk-outline', 'walk'],
  energy5: ['tennisball-outline', 'tennisball'],

  profile: ['paw-outline', 'paw'],
  emergency: ['medkit-outline', 'medkit'],
  medication: ['medical-outline', 'medical'],
  calendar: ['calendar-outline', 'calendar'],
  trend: ['trending-up-outline', 'trending-up'],
  timer: ['stopwatch-outline', 'stopwatch'],
  night: ['moon-outline', 'moon'],
  camera: ['camera-outline', 'camera'],
  edit: ['pencil-outline', 'pencil'],
  add: ['add', 'add'],
  chevron: ['chevron-forward', 'chevron-forward'],
  clock: ['time-outline', 'time'],
  empty: ['file-tray-outline', 'file-tray'],
  // A seizure video whose bytes live on the phone that recorded it. The glyph
  // has to read as "another device", not as "broken" — see VideoTile.
  device: ['phone-portrait-outline', 'phone-portrait'],
  // Points the opposite way to `chevron`, which marks "go deeper" on nav rows.
  // The two must not be the same glyph or the direction stops meaning anything.
  back: ['chevron-back', 'chevron-back'],
} as const;

export type IconName = keyof typeof GLYPHS;

export function Icon({
  name,
  size = 'lg',
  color = colors.ink,
  filled = false,
}: {
  name: IconName;
  size?: IconSize;
  color?: string;
  filled?: boolean;
}) {
  const pair = GLYPHS[name];
  const glyph = filled ? pair[1] : pair[0];
  return (
    <Ionicons
      name={glyph}
      size={ICON_SIZE[size]}
      color={color}
      // Decorative by default: the label beside it carries the meaning, and a
      // screen reader announcing "paw icon" before "Choose breed" is noise.
      accessibilityElementsHidden
      importantForAccessibility="no"
    />
  );
}
