/**
 * Something went wrong, said in a way an owner can act on.
 *
 * ── WHAT IT REPLACES ──────────────────────────────────────────────────
 *
 * The sign-in and sign-up screens each had this:
 *
 *   {error && <View style={[styles.card, styles.errorCard]}><Body>{error}</Body></View>}
 *
 * A red rectangle containing whatever string the provider threw. No title, so
 * nothing to scan; no icon, so it did not read as a state change; no way to
 * dismiss it, so it sat there after the owner had moved on; and no action, so
 * a recoverable problem and a permanent one looked identical.
 *
 * ── THE SHAPE, AND WHY IT MATCHES ClusterAlert ────────────────────────
 *
 * The app already has one "something needs your attention" pattern — the
 * cluster banner on Home: a tinted card, a white circular icon, a bold line
 * and a calmer line under it. This reuses that vocabulary deliberately, at a
 * lower volume. Inventing a second visual language for problems would make
 * the two compete, and the cluster banner is the one that must win: it is
 * about the dog, this is about a login.
 *
 * So: same structure, same radius, same icon treatment — but the AMBER
 * palette, not red. Red in this app means a seizure. A failed sign-in is not
 * an emergency and must not borrow the colour of one.
 *
 * ── RETRY IS CONDITIONAL, ON PURPOSE ──────────────────────────────────
 *
 * `onRetry` is only rendered when the caller says the error is retryable.
 * Offering "Try again" on a configuration fault that cannot resolve itself is
 * the app wasting the owner's time and hiding that the fault is ours.
 */

import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';

export type ErrorNoticeProps = {
  title: string;
  body: string;
  /** Rendered only when provided. See the note above. */
  onRetry?: () => void;
  /** Rendered only when provided; clears the error without retrying. */
  onDismiss?: () => void;
  retryLabel?: string;
};

export function ErrorNotice({
  title,
  body,
  onRetry,
  onDismiss,
  retryLabel = 'Try again',
}: ErrorNoticeProps) {
  return (
    <View
      style={styles.card}
      // One node, one announcement. Without this the screen reader reads the
      // icon, the title and the body as three unrelated fragments, and the
      // owner has to assemble the meaning themselves.
      accessible
      accessibilityRole="alert"
      accessibilityLabel={`${title}. ${body}`}
    >
      <View style={styles.row}>
        <View style={styles.iconWrap}>
          <Icon name="warning" size="md" color={colors.amberInk} filled />
        </View>

        <View style={styles.text}>
          <Text style={styles.title}>{title}</Text>
          <Text style={styles.body}>{body}</Text>
        </View>

        {onDismiss ? (
          <Pressable
            onPress={onDismiss}
            accessibilityRole="button"
            accessibilityLabel="Dismiss this message"
            // The visible glyph is small; hitSlop takes the touch target to
            // the platform minimum without growing the layout.
            hitSlop={12}
            style={({ pressed }) => [styles.dismiss, pressed && styles.pressed]}
          >
            <Icon name="clear" size="sm" color={colors.amberInk} />
          </Pressable>
        ) : null}
      </View>

      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          accessibilityLabel={retryLabel}
          style={({ pressed }) => [styles.retry, pressed && styles.pressed]}
        >
          <Text style={styles.retryLabel}>{retryLabel}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.amberTint,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.amber,
    padding: spacing.md,
    gap: spacing.sm,
  },
  row: { flexDirection: 'row', alignItems: 'flex-start', gap: spacing.md },
  iconWrap: {
    width: 34,
    height: 34,
    // A CIRCLE: half of 34. Not a step on the radius scale — snapping this to
    // a token turns the circle into a rounded square.
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.card,
    flex: 0,
  },
  text: { flex: 1, gap: 2 },
  title: {
    fontSize: fontSize.base,
    fontWeight: '800',
    color: colors.amberInk,
    fontFamily: fontFamily.extrabold,
  },
  body: {
    fontSize: fontSize.sm,
    lineHeight: 19,
    color: colors.ink,
    fontFamily: fontFamily.regular,
  },
  dismiss: { paddingTop: 2, flex: 0 },
  retry: {
    alignSelf: 'flex-start',
    // Indented to line up with the TEXT, not the icon, so the action reads as
    // belonging to the sentence above it rather than to the card as a whole.
    marginLeft: 34 + spacing.md,
    paddingVertical: 6,
    paddingHorizontal: spacing.md,
    borderRadius: radius.control,
    backgroundColor: colors.card,
    borderWidth: 1,
    borderColor: colors.amber,
  },
  retryLabel: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.amberInk,
    fontFamily: fontFamily.bold,
  },
  pressed: { opacity: 0.7 },
});
