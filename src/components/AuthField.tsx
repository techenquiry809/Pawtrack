/**
 * A labelled text field for the auth screens.
 *
 * ── WHY THE AUTOFILL HINTS MATTER MORE THAN THEY LOOK ─────────────────
 *
 * `textContentType` and `autoComplete` are what let iCloud Keychain, 1Password
 * and Google Password Manager offer to generate and save a credential. Get
 * them wrong and the OS silently does nothing — the field still works, so it
 * looks fine, and every user is quietly pushed toward a password they can
 * remember and therefore reuse.
 *
 * On an app holding health records that is a real security outcome decided by
 * two string props, which is why they are required here rather than optional.
 *
 * The distinction that actually bites: `newPassword` on a signup field is what
 * triggers "Use Strong Password"; `password` on a sign-in field is what
 * triggers autofill of an existing one. Using `password` on signup means the
 * generator never appears.
 */

import { useState } from 'react';
import {
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
  type KeyboardTypeOptions,
  type TextInputProps,
} from 'react-native';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';

export type AuthFieldProps = {
  label: string;
  value: string;
  onChangeText: (value: string) => void;
  placeholder?: string;
  /** Shown under the label. Use it to mark a field optional. */
  hint?: string;
  /** Validation message. Also sets the error styling. */
  error?: string | null;
  secure?: boolean;
  keyboardType?: KeyboardTypeOptions;
  autoComplete?: TextInputProps['autoComplete'];
  textContentType?: TextInputProps['textContentType'];
  autoCapitalize?: TextInputProps['autoCapitalize'];
  returnKeyType?: TextInputProps['returnKeyType'];
  onSubmitEditing?: () => void;
  editable?: boolean;
};

export function AuthField({
  label,
  value,
  onChangeText,
  placeholder,
  hint,
  error,
  secure = false,
  keyboardType,
  autoComplete,
  textContentType,
  autoCapitalize = 'none',
  returnKeyType,
  onSubmitEditing,
  editable = true,
}: AuthFieldProps) {
  const [hidden, setHidden] = useState(secure);
  const [focused, setFocused] = useState(false);

  return (
    <View style={styles.wrap}>
      <View style={styles.labelRow}>
        <Text style={styles.label}>{label}</Text>
        {hint ? <Text style={styles.hint}>{hint}</Text> : null}
      </View>

      <View
        style={[
          styles.field,
          focused && styles.fieldFocused,
          error ? styles.fieldError : null,
        ]}
      >
        <TextInput
          value={value}
          onChangeText={onChangeText}
          placeholder={placeholder}
          placeholderTextColor={colors.inkSoft}
          secureTextEntry={hidden}
          keyboardType={keyboardType}
          autoComplete={autoComplete}
          textContentType={textContentType}
          autoCapitalize={autoCapitalize}
          autoCorrect={false}
          returnKeyType={returnKeyType}
          onSubmitEditing={onSubmitEditing}
          editable={editable}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          style={styles.input}
          accessibilityLabel={label}
        />

        {secure ? (
          <Pressable
            onPress={() => setHidden((h) => !h)}
            hitSlop={12}
            accessibilityRole="button"
            // Describes what the CONTROL does, not what the state is. A label
            // reading "Password hidden" gets announced as if it were the value
            // of the field next to it.
            accessibilityLabel={hidden ? 'Show password' : 'Hide password'}
            style={styles.reveal}
          >
            <Text style={styles.revealText}>{hidden ? 'Show' : 'Hide'}</Text>
          </Pressable>
        ) : null}
      </View>

      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: spacing.xs },
  labelRow: { flexDirection: 'row', alignItems: 'baseline', gap: spacing.sm },
  label: {
    fontSize: fontSize.sm,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: 0.2,
    fontFamily: fontFamily.bold
  },
  hint: { fontSize: fontSize.xs, color: colors.inkSoft, fontFamily: fontFamily.regular },

  field: {
    flexDirection: 'row',
    alignItems: 'center',
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: radius.field,
    backgroundColor: colors.bg,
    paddingHorizontal: spacing.md,
  },
  fieldFocused: { borderColor: colors.teal },
  fieldError: { borderColor: colors.red, backgroundColor: colors.redTint },

  input: {
    flex: 1,
    fontSize: fontSize.md,
    color: colors.ink,
    // iOS renders a taller field than Android for the same padding; pinning a
    // minimum keeps the builds identical and both above the 44pt touch target.
    minHeight: Platform.OS === 'ios' ? 50 : 48,
    fontFamily: fontFamily.regular
  },

  reveal: { paddingLeft: spacing.sm, paddingVertical: spacing.sm },
  revealText: { fontSize: fontSize.sm, fontWeight: '700', color: colors.teal, fontFamily: fontFamily.bold },

  error: { fontSize: fontSize.xs, color: colors.redDeep, fontWeight: '600', fontFamily: fontFamily.semibold },
});
