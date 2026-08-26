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
