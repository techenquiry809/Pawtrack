/**
 * Geometry for the floating chrome — the island tab bar and the Record button.
 *
 * One hook, because four screens plus two components all have to agree on
 * where the island is. When these numbers lived as constants they drifted:
 * the FAB was positioned against a tab-bar height that no longer existed.
 *
 * ── WHAT WAS WRONG WITH THE FIRST ATTEMPT ─────────────────────────────
 *
 * `bottom: insets.bottom + 10` looks device-agnostic and is not. `insets.bottom`
 * is 34 on any iPhone with a home indicator and 0 on one without, so the same
 * line produced:
 *
 *   iPhone 17    44pt above the edge — a wide strip of content showing beneath
 *                the bar, which reads as a rendering mistake
 *   iPhone SE    10pt above the edge — nearly touching
 *
 * Same code, opposite problems. The fix is to treat the safe-area inset as
 * something to CLEAR, not something to add to.
 *
 * ── THE RULES ─────────────────────────────────────────────────────────
 *
 *   vertical    sit a consistent distance above the home indicator, or above
 *               the screen edge when there is not one
 *   horizontal  respect left/right insets so landscape does not put the island
 *               under a notch
 *   width       cap it — a four-tab bar stretched across an iPad is 712pt of
 *               nothing between icons
 *   type        grow the island when the OS text size grows, because the
 *               labels scale and nothing in this app disables that
 */

import { useWindowDimensions } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

/**
 * How much of the bottom safe area is the home indicator itself.
 *
 * The inset is ~34pt but the indicator only occupies the lower ~21pt of it;
 * the rest is Apple's own breathing room, which a floating element is entitled
 * to use. Sitting at the full inset is what pushed the island 44pt up.
 */
const HOME_INDICATOR = 12;

/** Never closer than this to the bottom edge, on any device. */
const MIN_BOTTOM_GAP = 12;

/** Beyond this the tabs are just far apart. Tablets and landscape hit it. */
const MAX_ISLAND_WIDTH = 440;

/** Narrow phones give back some margin rather than squeezing the tabs. */
const NARROW_SCREEN = 360;

const BASE_ISLAND_HEIGHT = 64;

/**
 * How far the Record disc stands proud of the island's top edge.
 *
 * ── WHY IT OVERHANGS AT ALL ───────────────────────────────────────────
 *
 * Because a row of five equal columns makes the one time-critical control in
 * the app look like a fifth tab. Lifting the disc past the bar's edge is what
 * separates "the thing you press when something is happening" from "the
 * things you press to look around".
 *
 * ── AND WHY ONLY 6pt ──────────────────────────────────────────────────
 *
 * This button used to float free above the bar, and it was moved down for a
 * real reason: it covered whatever was beneath it — on the check-in form it
 * sat squarely over the Water row. A small overhang buys the separation
 * without the collision, and `contentClearance` below reserves exactly this
 * much extra so no screen can put content under the part that sticks out.
 *
 * ── IT CRESTS THE TOP ONLY, AND THAT IS THE POINT ─────────────────────
 *
 * A version of this straddled the bar, cresting both edges. It cannot be
 * small: a circle that clears both edges of a 64pt bar is at least 64pt
 * across, nearly twice the 38pt glyph slots beside it, and it leaves no strip
 * of bar underneath to print "Record" on. It looked like an ornament the bar
 * was passing behind, and it cost the one word that tells somebody what the
 * red disc does.
 *
 * Cresting the top only keeps the disc at 46 and keeps the label. 8, not the
 * 20 this was first set to — twenty read as a detached floating button, and
 * below about 6 the crest disappears into the bar's own edge highlight and
 * the disc just looks oversized.
 *
 * Exported so FloatingTabBar positions the disc from the same number the
 * padding is computed from. Two constants would drift, and the failure would
 * be a scroll list tucking its last row under the disc.
 */
export const RECORD_OVERHANG = 8;

export type ChromeMetrics = {
  /** Island height, grown for large OS text. */
  islandHeight: number;
  /** Distance from the island's bottom edge to the screen's bottom edge. */
  islandBottom: number;
  /** Island width, capped and inset-aware. */
  islandWidth: number;
  islandRadius: number;
  /**
   * Bottom padding a scrolling screen needs so its last row clears the island
   * AND the part of the Record disc that stands above it.
   *
   * It once reserved ~72pt for a Record button that floated free of the bar.
   * The disc now only overhangs by RECORD_OVERHANG, so this is that much
   * rather than the old full float — see the note on that constant.
   */
  contentClearance: number;
};

export function useChromeMetrics(): ChromeMetrics {
  const insets = useSafeAreaInsets();
  const { width, fontScale } = useWindowDimensions();

  // Grow with OS text size so labels never clip. Capped, because past ~1.6 the
  // bar would eat the screen and the labels are already at their useful limit.
  const scale = Math.min(Math.max(fontScale, 1), 1.6);
  const islandHeight = Math.round(BASE_ISLAND_HEIGHT + (scale - 1) * 22);

  // Clear the home indicator rather than the whole inset.
  const islandBottom = Math.max(insets.bottom - HOME_INDICATOR, MIN_BOTTOM_GAP);

  const margin = width < NARROW_SCREEN ? 12 : 16;
  const available = width - margin * 2 - insets.left - insets.right;
  const islandWidth = Math.min(Math.max(available, 0), MAX_ISLAND_WIDTH);

  return {
    islandHeight,
    islandBottom,
    islandWidth,
    islandRadius: Math.round(islandHeight / 2),
    contentClearance: islandBottom + islandHeight + RECORD_OVERHANG + 16,
  };
}
