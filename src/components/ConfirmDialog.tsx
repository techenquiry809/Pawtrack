/**
 * "Are you sure?", for the two irreversible things on the Account screen.
 *
 * ── WHAT IT REPLACES ──────────────────────────────────────────────────
 *
 * Cards that unfolded inside the settings list. Both of them pushed the rest
 * of the page down, both could be scrolled out of sight while still being the
 * app's live question, and — the part that mattered — the button that deletes
 * every record of a dog's illness sat in a scrolling list at the same size and
 * in the same place as the button that signs you out.
 *
 * ── THE PAUSE IS DELIBERATE ───────────────────────────────────────────
 *
 * The destructive button is NOT the first thing under the text, and it is not
 * the one the thumb lands on. Cancel is placed last, closest to the bottom of
 * the card, because that is where the hand is. This costs a person who really
 * meant it about half a second, and it is the only protection between a
 * mis-tap and a permanently deleted medical history.
 */

import { Body, Button, Heading } from '@/components/ui';
import { Dialog } from '@/components/Dialog';
import { StyleSheet } from 'react-native';
import { spacing } from '@/theme/tokens';

export type ConfirmDialogProps = {
  visible: boolean;
  title: string;
  /** One or more paragraphs. Each is rendered with its own spacing. */
  body: string[];
  /** The destructive action's label — say what it DOES, never "OK". */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** True while the action is running; locks every control including Cancel. */
  busy?: boolean;
};

export function ConfirmDialog({
  visible,
  title,
  body,
  confirmLabel,
  onConfirm,
  onCancel,
  busy = false,
}: ConfirmDialogProps) {
  return (
    <Dialog
      visible={visible}
      // No escape while the action is in flight. Half a deletion is worse than
      // either outcome, and the gesture gives no chance to say so.
      onRequestClose={busy ? undefined : onCancel}
    >
      <Heading>{title}</Heading>

      {body.map((paragraph) => (
        <Body key={paragraph} style={styles.body}>
          {paragraph}
        </Body>
      ))}

      <Button
        label={confirmLabel}
        variant="danger"
        onPress={onConfirm}
        loading={busy}
        disabled={busy}
      />
      <Button label="Cancel" variant="ghost" onPress={onCancel} disabled={busy} />
    </Dialog>
  );
}

const styles = StyleSheet.create({
  body: { lineHeight: 21, marginBottom: spacing.xs },
});
