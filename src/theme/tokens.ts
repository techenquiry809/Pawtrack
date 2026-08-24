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
} as const;

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
