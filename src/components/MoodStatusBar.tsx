/**
 * What the Daily Pulse becomes once it has been answered.
 *
 * ── WHY THE CARD NO LONGER JUST VANISHES ──────────────────────────────
 *
 * The pulse used to collapse to nothing. That was right about one thing — a
 * full-height card asking a question it has already had answered is clutter
 * sitting on top of the seizure timer — and wrong about another: the answer
 * disappeared with it. An owner who tapped a face and then scrolled had no way
 * to see what they had recorded without opening the Check-in tab, and the
 * commonest question about a thing you just did is "did that go in?".
 *
 * So the card does not collapse to zero. It collapses to a LINE: the same
 * slot, a fraction of the height, showing the dog, the mood, and a way back
 * in. The screen still gets its space back; the answer stays visible.
 *
 * ── THE FACE IS THE MOOD, NOT THE DOG ─────────────────────────────────
 *
 * The avatar here is the mood illustration — the same one that was tapped —
 * and deliberately NOT the dog's photo. The photo already sits in the screen
 * header directly above; repeating it would make this read as a second header
 * rather than as the outcome of an answer. Showing the chosen face instead
 * makes the bar a continuation of the tap: the face that was picked is the
 * face that stays.
 *
 * ── WHY IT IS WHITE, AND WHY THE FACE HAS NO TILE BEHIND IT ───────────
 *
 * The reference this was built from is a warm tinted bar on a white page,
 * with the avatar in a white tile. Home is the other way round — cream page,
 * white cards — so a tinted bar would fight the background, and the middle
 * step's own tint IS the page colour (`Steady` is `colors.bg`), which would
 * leave the neutral answer looking unstyled. The card stays white like every
 * other card on the screen.
 *
 * The tile behind the face went the same way, for a harder reason: the mood
 * artwork has NO ALPHA CHANNEL. `src/assets/moods/*.png` are RGB 192×192 with
 * an opaque near-white field, so anything placed behind them shows up as a
 * white square around the dog rather than as a frame. It is invisible in the
 * pulse row only because that row sits on a white card. Put the same image on
 * a tinted tile and the seam appears immediately.
 *
 * So the face sits directly on the card, where its own background disappears,
 * and the step's colour does its work on the mood word instead.
 *
 * Colour is never the only channel. The illustration, the word, and the
 * screen-reader label all say which mood this is.
 */

import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Pill } from '@/components/ui';
import { moodImage } from '@/components/MoodFace';
import { colors, fontFamily, fontSize, radius, shadow, spacing } from '@/theme/tokens';

export type MoodStatusBarProps = {
  dogName: string;
  /** Shown as a chip beside the name. Omitted when the dog has no breed set. */
  breed?: string | null;
  /** 1 (Flat) through 5 (Bouncy) — picks the illustration. */
  value: number;
  /** 'Flat' … 'Bouncy'. The step's own word, not a re-derivation. */
  moodName: string;
  /** The step's solid colour, for the mood word. */
  solid: string;
  /** A single emoji that reinforces the step. Purely additive — never alone. */
  glyph: string;
  /** Opens the check-in, where the answer can be changed or expanded. */
  onPress: () => void;
};

export function MoodStatusBar({
  dogName,
  breed,
  value,
  moodName,
  solid,
  glyph,
  onPress,
}: MoodStatusBarProps) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      // One label for the whole bar. Read as five fragments — name, breed,
      // "Mood:", the word, the icon — it takes a screen-reader user three
      // passes to assemble the one sentence a sighted user reads at a glance.
      accessibilityLabel={`${dogName} is ${moodName.toLowerCase()} today. Open check-in to change it.`}
      style={({ pressed }) => [styles.bar, pressed && styles.pressed]}
    >
      {/* ---- Mood avatar, with a "recorded" tick ---------------------- */}
      <View style={styles.avatarWrap}>
        <Image
          source={moodImage(value)}
          style={styles.avatarImage}
          resizeMode="contain"
          accessibilityIgnoresInvertColors
        />
        {/*
          The tick is the confirmation the disappearing card used to carry and
          then take away with it. Small, and it never moves — it says
          "recorded", not "well done".
        */}
        <View style={styles.tick}>
          <Icon name="check" size="sm" color={colors.card} />
        </View>
      </View>

      {/* ---- Name, breed, mood --------------------------------------- */}
      <View style={styles.text}>
        <View style={styles.nameRow}>
          <Text style={styles.name} numberOfLines={1}>
            {dogName}
          </Text>
          {/*
            The app's own Pill, not a chip styled to look like one. Six other
            screens label a secondary fact this way — "Logged later", "Signed
            out", "12 days" — and a hand-rolled lookalike here would be the
            seventh variant of one thing, drifting the first time the shared
            one is touched. It shrinks rather than pushing the name off.
          */}
          {breed ? (
            <View style={styles.breedSlot}>
              <Pill label={breed} tone="neutral" />
            </View>
          ) : null}
        </View>

        <Text style={styles.moodRow} numberOfLines={1}>
          <Text style={styles.moodLabel}>Mood: </Text>
          <Text style={[styles.moodValue, { color: solid }]}>{moodName}</Text>
          <Text style={styles.moodGlyph}> {glyph}</Text>
        </Text>
      </View>

      {/* ---- Way back in --------------------------------------------- */}
      {/*
        One action, not the two in the reference. The second there is a bell,
        and there is nothing honest to wire it to from here — reminders belong
        to medications and are set up in their own screen. A button that opens
        something unrelated to the mood it sits next to is worse than no
        button. The whole bar is pressable anyway; this is the visible
        affordance saying so.
      */}
      <View style={styles.action}>
        <Icon name="calendar" size="md" color={colors.tealDeep} />
      </View>
    </Pressable>
  );
}

/**
 * A little larger than the 44 the pulse row draws these at: with no tile
 * around it the face has to hold the left of the bar on its own.
 */
const AVATAR = 52;
const TICK = 17;

const styles = StyleSheet.create({
  /**
   * Geometry copied from the dashboard's own `styles.card`, deliberately and
   * exactly: same radius, same 14pt padding, same hairline border, same
   * shadow, same 20pt top margin. This sits in a column with the recorder and
   * the data cards, and a block that agrees with them on four values out of
   * six looks like a mistake rather than like a variation.
   *
   * ── THE MARGIN IS THE LOAD-BEARING ONE ────────────────────────────────
   *
   * Every top-level block on Home carries its OWN `marginTop: spacing.lg` —
   * ClusterAlert's style has a note explaining what happened the last time
   * one of them inherited its spacing from a neighbour instead. This one
   * shipped without any, so it butted straight up under the breed line in the
   * header with nothing between them, and the gap changed depending on which
   * state the pulse slot was in.
   */
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.md,
    marginTop: spacing.lg,
    padding: spacing.md,
    backgroundColor: colors.card,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.line,
    ...shadow.card,
  },
  pressed: { opacity: 0.85 },

  // Not clipped: the tick deliberately hangs off the corner of the face, and
  // `overflow: hidden` on the wrapper would cut it in half.
  avatarWrap: { width: AVATAR, height: AVATAR },
  avatarImage: { width: AVATAR, height: AVATAR },
  tick: {
    position: 'absolute',
    // Pushed OFF the artwork, not onto it. With no tile to sit on the corner
    // of, a badge tucked inside the 52pt box lands on the dog's chest and
    // reads as a sticker covering the illustration rather than as a mark
    // beside it.
    right: -5,
    bottom: -1,
    width: TICK,
    height: TICK,
    borderRadius: TICK / 2,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.green,
    // A ring in the card's own colour, so the tick reads as sitting ON the
    // tile rather than as part of the illustration behind it.
    borderWidth: 2,
    borderColor: colors.card,
  },

  text: { flex: 1, gap: 2 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  name: {
    fontSize: fontSize.md,
    fontWeight: '800',
    color: colors.ink,
    fontFamily: fontFamily.extrabold,
    flexShrink: 1,
  },
  // Lets the chip give way to the name rather than pushing it out of the row.
  breedSlot: { flexShrink: 1 },
  moodRow: { fontSize: fontSize.base },
  moodLabel: {
    fontSize: fontSize.base,
    color: colors.inkSoft,
    fontFamily: fontFamily.regular,
  },
  moodValue: {
    fontSize: fontSize.base,
    fontWeight: '800',
    fontFamily: fontFamily.extrabold,
  },
  moodGlyph: { fontSize: fontSize.base },

  /**
   * A tinted round control, which is what this screen already uses for an
   * action sitting INSIDE a card — see `pulseCta`, the "Check-in Now" pill in
   * the asking card this bar replaces. The white-with-a-shadow treatment is
   * for buttons on the PAGE (the header's gear); repeating it on a white card
   * gives a white button on white with only a shadow to separate them.
   */
  action: {
    width: 40,
    height: 40,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.tealTint,
  },
});
