/**
 * The shell every dialog in this app shares: scrim, card, pop-in.
 *
 * ── WHY IT IS A SHELL AND NOT FIVE COPIES ─────────────────────────────
 *
 * The sign-out confirmation was the first thing here to be a real dialog, and
 * the moment it existed the Account screen had two DIFFERENT ways of asking a
 * dangerous question on one page: a dialog for signing out, and cards that
 * unfolded in the list for removing data and deleting the account. Same
 * severity, same shape of question, two answers to "where do I look".
 *
 * So the arrival — the scrim weight, the card geometry, the spring — lives
 * here once, and the things that differ (the words, the buttons, what the
 * buttons do) stay with each caller.
 *
 * ── THE POP ───────────────────────────────────────────────────────────
 *
 * `Modal`'s own `animationType="fade"` carries the scrim. The card rides a
 * spring on top of it, from 0.92 scale and 16pt down, with enough give to
 * overshoot slightly. A dialog that only fades reads as a screen that was
 * always there; one that arrives reads as a response to the tap that opened
 * it, which is the whole difference between this and the card it replaced.
 */

import { useEffect, useRef, type ReactNode } from 'react';
import { Animated, Modal, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';
import { useReducedMotion } from '@/theme/motion';

export type DialogProps = {
  visible: boolean;
  /**
   * Android back button and the iOS accessibility escape gesture.
   *
   * Pass undefined while something is in flight — there is no safe point to
   * abandon a destructive action halfway through it.
   */
  onRequestClose?: () => void;
  children: ReactNode;
};

export function Dialog({ visible, onRequestClose, children }: DialogProps) {
  const reduced = useReducedMotion();
  const pop = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (!visible) return;

    if (reduced) {
      pop.setValue(1);
      return;
    }

    pop.setValue(0);
    const anim = Animated.spring(pop, {
      toValue: 1,
      stiffness: 260,
      damping: 22,
      mass: 0.9,
      useNativeDriver: true,
    });
    anim.start();
    return () => anim.stop();
  }, [visible, reduced, pop]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={() => onRequestClose?.()}
    >
      <View style={styles.scrim}>
        <Animated.View
          style={[
            styles.card,
            {
              opacity: pop,
              transform: [
                { scale: pop.interpolate({ inputRange: [0, 1], outputRange: [0.92, 1] }) },
                { translateY: pop.interpolate({ inputRange: [0, 1], outputRange: [16, 0] }) },
              ],
            },
          ]}
        >
          {children}
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  scrim: {
    flex: 1,
    // One weight of "the screen behind is not available" across the app.
    // UnfinishedSeizurePrompt set this first; it is repeated here rather than
    // tokenised because it is the only value of its kind in the design.
    backgroundColor: 'rgba(32,41,58,0.45)',
    justifyContent: 'center',
    padding: spacing.lg,
  },
  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },
});
