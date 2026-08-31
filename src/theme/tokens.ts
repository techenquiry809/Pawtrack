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

/**
 * Corner radii.
 *
 * ── THE SHAPE LANGUAGE ────────────────────────────────────────────────
 *
 *   sm    every INTERACTIVE control — buttons, chips, segmented controls,
 *         inputs, the tab bar's active chip. This is shadcn's rounded-lg,
 *         and it is what makes a tap target recognisable as one.
 *   md    cards and panels — a surface that HOLDS controls.
 *   lg    large containers: sheets, modals, the alert banner.
 *   pill  status BADGES and avatars only. A badge is a label, not a
 *         control, and the fully-round shape is what says so. Using it on
 *         a button was the old inconsistency: it made a control look like
 *         a badge and a badge look like a control.
 *
 * ── WHAT IS DELIBERATELY NOT A TOKEN ──────────────────────────────────
 *
 * Half-of-dimension radii stay as raw numbers, because they are not style
 * choices — they are the arithmetic that makes a shape a circle. A 14pt
 * legend swatch at radius 7, an 8pt progress rail at radius 4, a 4pt spark
 * bar at radius 2: snapping any of those to a token would turn a circle
 * into a rounded rectangle. They are computed values that happen to be
 * small, not magic numbers.
 */
export const radius = {
  /**
   * Interactive controls — buttons, chips, segmented controls, the tab chip.
   *
   * Fully round, and that is the whole point: a pill reads as soft and
   * touchable where a 12pt rectangle reads as a form field on a government
   * website. This app is about somebody's dog.
   */
  control: 100,
  /**
   * Text fields. Round, but deliberately NOT a pill.
   *
   * A pill works on a control whose height is fixed. A note field grows to
   * four lines, and a 100pt radius on a 90pt-tall box collapses into a
   * lozenge with unusable corners — the text starts halfway across the first
   * line. This is the one place where softness has to yield.
   */
  field: 20,
  /** Cards and panels — a surface that HOLDS controls. */
  card: 24,
  /** Sheets, modals and full-width banners. */
  sheet: 28,
  /** Status badges and avatars. Same value as `control`, different meaning. */
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
  /**
   * The lift under a filled or outlined Button.
   *
   * Much tighter than `card`: a button sits ON a card, so it needs to read as
   * a separate surface without implying it floats as far off the page as the
   * card does. A 1pt offset with a 2pt blur is the smallest shadow that still
   * survives Android's elevation rounding.
   */
  /**
   * The lift under a control.
   *
   * Warm, not black. A pure-black shadow on a cream background reads as grey
   * grime collecting under the button; tinting it with the ink colour (which
   * is itself a warm navy) keeps the whole surface in one temperature. Soft
   * and wide rather than tight and dark — the difference between something
   * moulded and something stamped.
   */
  button: {
    shadowColor: '#20293A',
    shadowOpacity: 0.10,
    shadowRadius: 6,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
} as const;

/**
 * Font sizes. These are base sizes — they scale automatically with the user's
 * OS text-size setting because we do NOT set `allowFontScaling={false}`
 * anywhere. Accessibility was an explicit requirement of this app.
 */
/**
* Nunito — rounded terminals, warm and friendly.
 *
 * Replaces Inter, which was correct for matching the shadcn reference and
 * wrong for this app: Inter is engineered to be NEUTRAL, and neutral is the
 * one thing a dog-care app should not feel. Nunito's rounded terminals do the
 * cheerful work that the corner radii alone could not.
 *
 * Nunito over the rounder alternatives (Quicksand, Baloo) because it carries
 * the full 200-1000 weight range — the 11pt tab labels and the red seizure
 * timer both need real weight to stay legible, and a display face that caps at
 * 700 with thin strokes would trade legibility for charm on exactly the
 * screens where legibility matters most.
 *
 * ── WHY EACH WEIGHT IS A SEPARATE FAMILY ──────────────────────────────
 *
 * These are STATIC faces, so `fontWeight` alone will not select between them.
 * iOS may fake it by synthesising a bolder outline; Android silently ignores
 * the weight and renders everything at 400. The only portable way to get a
 * real 600 is to name the 600 face.
 *
 * So every text style sets BOTH: `fontFamily` picks the actual face, and
 * `fontWeight` stays alongside it so the system still knows the semantic
 * weight — screen readers and text-selection UI read it, and it keeps the
 * styles legible next to the shadcn classes they came from.
 *
 * `weightFamily` is the mapping, so a style can be written from a weight
 * without anyone memorising Google's face names.
 */
export const fontFamily = {
  regular: 'Nunito_400Regular',
  medium: 'Nunito_500Medium',
  semibold: 'Nunito_600SemiBold',
  bold: 'Nunito_700Bold',
  extrabold: 'Nunito_800ExtraBold',
} as const;

export const weightFamily = {
  '400': fontFamily.regular,
  normal: fontFamily.regular,
  '500': fontFamily.medium,
  '600': fontFamily.semibold,
  '700': fontFamily.bold,
  bold: fontFamily.bold,
  '800': fontFamily.extrabold,
  '900': fontFamily.extrabold,
} as const;

export const fontSize = {
  xs: 11,
  sm: 12.5,
  base: 14.5,
  md: 16,
  lg: 20,
  xl: 26,
  display: 30,
  /**
   * Elapsed time, which had drifted to FOUR sizes across four screens
   * (38 via `timer - 8`, 40, 56, 68) for one semantic thing. Three tiers,
   * named for the job rather than the screen:
   */
  /** A finished seizure's duration, read at a glance in a list or header. */
  timerSm: 40,
  /** The recovery countdown — important, but not the only thing on screen. */
  timerMd: 56,
  /** The live timer. The largest type in the app, and deliberately so. */
  timerLg: 68,
} as const;

/**
 * Minimum touch target. The seizure screen is used one-handed by a panicking
 * person, so nothing interactive may be smaller than this.
 */
export const MIN_TOUCH_TARGET = 48;
