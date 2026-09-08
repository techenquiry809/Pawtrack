/**
 * The last thing between a render bug and a blank screen.
 *
 * ── WHY THIS HAD TO EXIST ─────────────────────────────────────────────
 *
 * There was no error boundary anywhere in the app. React's default on an
 * uncaught render error is to unmount the whole tree, so a single bad `.map()`
 * in one component took the entire app to a white screen with no way back
 * short of force-quitting.
 *
 * Expo Router does not supply one by default either. It wraps a route in its
 * `<Try>` ONLY when that route module exports an `ErrorBoundary`
 * (node_modules/expo-router/build/useScreens.js) — no export, no wrapper.
 *
 * On most apps that is a bad afternoon. On this one the screen most likely to
 * be mounted when it happens is the live seizure timer, held by someone
 * watching their dog convulse. Losing the app at that moment costs the record
 * of the event and the timer they are reading, and asks them to reopen an app
 * while their hands are busy.
 *
 * ── WHAT IT DOES AND DELIBERATELY DOES NOT DO ─────────────────────────
 *
 * It does not try to repair anything. It says what happened in plain words,
 * states that saved records are intact — which is true, because every write in
 * this app lands in SQLite before it reaches a screen — and offers the two
 * actions worth offering: try this screen again, or go somewhere known-good.
 *
 * It does NOT auto-retry. A render error that fires on mount would loop, and a
 * flickering screen is worse than a still one that explains itself.
 *
 * The error text is shown rather than hidden. There is no crash reporter in
 * this app, so the only route from a real failure back to a fix is an owner
 * able to read out what it said.
 */

import { Component, type ReactNode } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { Body, Button, Muted } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

type Props = {
  children?: ReactNode;
  /**
   * Shown above the buttons. The live seizure screen overrides it, because
   * "your records are safe" is not the reassurance someone needs while a
   * seizure is still happening — see app/seizure/live.tsx.
   */
  message?: string;
  /** Extra action, rendered first. Used to get out of the seizure flow. */
  action?: { label: string; onPress: () => void };
  /**
   * Set by an expo-router `ErrorBoundary` export, which is handed `retry` by
   * the router and does not manage its own error state.
   */
  error?: Error;
  retry?: () => void;
};

type State = { error: Error | null };

export class AppErrorBoundary extends Component<Props, State> {
  override state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  override componentDidCatch(error: Error, info: { componentStack?: string | null }) {
    // console.error rather than a reporter: there is no crash service wired
    // up, and in a dev build this is what puts the component stack somewhere
    // findable.
    console.error('[crash] render error', error, info.componentStack);
  }

  private handleRetry = () => {
    // Router-supplied retry when this is a route boundary; otherwise clear our
    // own state and let the subtree mount again.
    if (this.props.retry) this.props.retry();
    this.setState({ error: null });
  };

  override render() {
    // `error` from props means the router caught it and is rendering us as its
    // fallback; `state.error` means we caught it ourselves.
    const error = this.props.error ?? this.state.error;
    if (!error) return this.props.children;

    const { action, message } = this.props;

    return (
      <View style={styles.screen}>
        <ScrollView contentContainerStyle={styles.content}>
          <Body style={styles.title}>Something went wrong on this screen.</Body>

          <Muted style={styles.line}>
            {message ??
              'Your saved records are safe — everything is stored on this phone as ' +
                'you enter it, not when a screen finishes drawing.'}
          </Muted>

          {action ? (
            <Button label={action.label} onPress={action.onPress} style={styles.button} />
          ) : null}

          <Button
            label="Try this screen again"
            variant={action ? 'ghost' : 'primary'}
            onPress={this.handleRetry}
            style={styles.button}
          />

          <Muted style={styles.detail}>
            If it keeps happening, this is the message to pass on:
          </Muted>
          <Muted style={styles.error}>{error.message || String(error)}</Muted>
        </ScrollView>
      </View>
    );
  }
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: {
    flexGrow: 1,
    justifyContent: 'center',
    padding: spacing.lg,
    gap: spacing.sm,
  },
  title: { fontWeight: '700', textAlign: 'center' },
  line: { textAlign: 'center', marginBottom: spacing.sm },
  button: { marginTop: spacing.xs },
  detail: { textAlign: 'center', marginTop: spacing.lg },
  error: { textAlign: 'center', color: colors.inkSoft },
});
