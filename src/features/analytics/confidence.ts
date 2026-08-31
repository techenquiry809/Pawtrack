/**
 * Sample size, translated into a word an owner can weigh.
 *
 * Its own module, importing nothing, so ./clusters can use it without dragging
 * in the `@/` path alias that makes the analytics barrel untestable under
 * Node's TypeScript stripping.
 */

export const CONFIDENCE_LEVELS = ['early', 'possible', 'repeated', 'strong'] as const;
export type Confidence = (typeof CONFIDENCE_LEVELS)[number];

/**
 * Sample size, translated into a word an owner can weigh.
 *
 * Deliberately conservative: "strong" needs 20 observations and still only
 * means "this pattern has repeated", never "this is established".
 */
export function confidenceFor(sampleSize: number): Confidence {
  if (sampleSize >= 20) return 'strong';
  if (sampleSize >= 10) return 'repeated';
  if (sampleSize >= 5) return 'possible';
  return 'early';
}

export const CONFIDENCE_BLURB: Record<Confidence, string> = {
  early: 'Very few records so far — treat this as a first impression.',
  possible: 'A handful of records. Worth watching, not concluding.',
  repeated: 'This has repeated across enough records to mention to your vet.',
  strong: 'A consistent pattern in your records. Still an association, not a cause.',
};

