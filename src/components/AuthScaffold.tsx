/**
 * The shared chrome every auth screen sits in.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * The auth flow is five screens now — sign in, sign up, forgot password,
 * verify, new password — and each one was otherwise going to re-declare the
 * same gradient, the same KeyboardAvoidingView, the same ScrollView padding
 * and the same card style. That is five places for the keyboard behaviour to
 * drift apart, and the keyboard is the one thing every screen here has to get
 * right: all five are a form with a text field near the bottom.
 *
 * The screens keep their own content and their own logic. Only the frame is
 * shared.
 */

import type { ReactNode } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  View,
} from 'react-native';
import { LinearGradient } from 'expo-linear-gradient';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { Muted, Title } from '@/components/ui';
import { colors, radius, spacing } from '@/theme/tokens';

export function AuthScaffold({
  title,
  lede,
  /**
   * Omit for a screen with nowhere to go back to (sign-in is the root of the
   * group). Pass a handler for a screen that must clean something up on the
   * way out — see the new-password screen, which has a live recovery session
   * to discard.
   */
  onBack,
  backLabel = 'Back',
  children,
}: {
  title: string;
  lede?: string;
  onBack?: () => void;
  backLabel?: string;
  children: ReactNode;
}) {
  const insets = useSafeAreaInsets();

  return (
    <View style={styles.screen}>
      <LinearGradient
        colors={[colors.tealTint, colors.bg]}
        start={{ x: 0.1, y: 0 }}
        end={{ x: 0.9, y: 1 }}
        style={StyleSheet.absoluteFill}
      />

      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <ScrollView
          contentContainerStyle={[
            styles.content,
            {
              paddingTop: insets.top + spacing.md,
              paddingBottom: insets.bottom + spacing.xl,
            },
          ]}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          {onBack ? <BackButton onPress={onBack} label={backLabel} /> : null}

          <View style={styles.heading}>
            <Title>{title}</Title>
            {lede ? <Muted style={styles.lede}>{lede}</Muted> : null}
          </View>

          {children}
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

/** The card the auth screens put their fields in. Exported so they match. */
export function AuthCard({
  children,
  tone = 'plain',
}: {
  children: ReactNode;
  tone?: 'plain' | 'info';
}) {
  return (
    <View style={[styles.card, tone === 'info' && styles.cardInfo]}>
      {children}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },

  heading: { gap: spacing.sm, marginTop: spacing.sm },
  lede: { lineHeight: 21 },

  card: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.md,
    shadowColor: '#20293A',
    shadowOpacity: 0.08,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  cardInfo: { backgroundColor: colors.tealTint },
});
