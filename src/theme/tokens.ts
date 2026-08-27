/**
 * Design tokens, ported 1:1 from the original web app's CSS custom properties
 * so the rebuilt app looks identical.
 *
 * Rule: components never hardcode a hex value. If a colour is missing here,
 * add it here rather than inlining it in a StyleSheet.
 */

export const colors = {
  bg: '#F6F2EA',
  card: '#FFFFFF',
  ink: '#20293A',
  inkSoft: '#5B6472',
  line: '#E7E0D2',

  teal: '#2F7E86',
  tealDeep: '#215D64',
  tealTint: '#E4EFEE',

  amber: '#DE9F3D',
  amberTint: '#FBF0DD',
  amberInk: '#8A5A17',

  red: '#D0483F',
  redDeep: '#A93327',
  redTint: '#FBEAE7',

  green: '#4C8B58',
  greenTint: '#EAF3EA',
  greenInk: '#2E5A37',

  /**
   * Text and icons sitting ON a photograph or a saturated fill — a duration
   * badge over a video frame, a label on the red record button.
   *
   * Pure white rather than `card`, and that is the point: the surface
   * underneath is an arbitrary video frame, so this has to hold contrast
   * against a bright kitchen floor as well as a dark bedroom. A near-white
   * tuned to the cream palette would not.
   */
  onMedia: '#FFFFFF',

  /**
   * The letterbox behind a video whose aspect ratio does not fill its frame.
   *
   * True black, not `ink`: this is the absence of picture, and every video
   * player the owner has ever used renders it this way. Tinting it to the
   * brand palette would read as a rendering fault.
   */
  mediaBackdrop: '#000000',

  /**
   * A frosted panel sitting ON a saturated fill, and its hairline edge.
   *
   * Translucent rather than a lighter tint of the fill: the recorder card is a
   * gradient from `red` to `redDeep`, so any fixed colour would match at one
   * end of the panel and band at the other. Letting the gradient through is
   * what keeps the card reading as one surface.
   */
  onMediaVeil: 'rgba(255, 255, 255, 0.16)',
  onMediaVeilEdge: 'rgba(255, 255, 255, 0.32)',

  /**
   * A dark disc behind a glyph laid over a video frame.
   *
   * A white play triangle alone vanishes the moment the poster frame is pale —
   * and a seizure is as likely to be filmed on a bright kitchen floor as in a
   * dark bedroom. Same reasoning as the caption scrim in VideoTile.
   */
  onMediaScrim: 'rgba(0, 0, 0, 0.45)',

  /** The dim behind a modal sheet. */
  scrim: 'rgba(32, 41, 58, 0.45)',
} as const;

/**
 * DATA-ENCODING palette — distinct from the brand colours above, on purpose.
 *
 * These three hues carry meaning in the Timeline (which event happened) rather
 * than decorating a surface, so they were validated rather than eyeballed:
 *
 *   node scripts/validate_palette.js "#C63F35,#B8801F,#0090A0" --mode light
 *   -> lightness band PASS · chroma floor PASS · CVD separation PASS
 *      (deutan dE 8.1) · normal-vision floor PASS (dE 15.0) · contrast PASS
 *
 * The original spec paired RED with GREEN, which fails hard: deuteranopic
 * separation dE 5.1 makes a seizure dot and a medication dot nearly identical
 * for red-green colour-blind readers — roughly 1 in 12 men. Amber replaces
 * green, which also frees green to stay a reserved STATUS colour ("Done") and
 * not double as a category.
 *
 * The teal here is more chromatic than colors.teal because the brand teal
 * measures 0.076 chroma and reads as grey at dot size. A small hue difference
 * between a 10px dot and a button is a fair trade for a legible encoding.
 *
 * NEVER rely on these alone: every event also carries a glyph and a text
 * label. Colour is the redundant channel, not the only one.
 */
export const eventColors = {
  seizure: '#C63F35',
  medication: '#B8801F',
  checkin: '#0090A0',
} as const;

export type EventKind = keyof typeof eventColors;

export const radius = {
  sm: 12,
  md: 18,
  lg: 24,
  pill: 100,
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 14,
  lg: 20,
  xl: 28,
} as const;

/**
 * Shadow needs different properties on iOS vs Android, so it is expressed as a
 * style object rather than raw values.
 */
export const shadow = {
  card: {
    shadowColor: '#20293A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  raised: {
    shadowColor: '#A93327',
    shadowOpacity: 0.35,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 10 },
    elevation: 6,
  },
} as const;

/**
 * Font sizes. These are base sizes — they scale automatically with the user's
 * OS text-size setting because we do NOT set `allowFontScaling={false}`
 * anywhere. Accessibility was an explicit requirement of this app.
 */
export const fontSize = {
  xs: 11,
  sm: 12.5,
  base: 14.5,
  md: 16,
  lg: 20,
  xl: 26,
  display: 30,
  timer: 46,
} as const;

/**
 * Minimum touch target. The seizure screen is used one-handed by a panicking
 * person, so nothing interactive may be smaller than this.
 */
export const MIN_TOUCH_TARGET = 48;
