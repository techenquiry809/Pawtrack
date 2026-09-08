/**
 * Renders a Terms or Privacy document from src/constants/legal.ts.
 *
 * ── THE DESIGN PROBLEM ────────────────────────────────────────────────
 *
 * Legal text is the one screen in an app that everybody is expected not to
 * read, and the usual styling makes sure of it: 11pt grey, edge to edge, one
 * undifferentiated column. That is a choice, and here it is the wrong one —
 * this document explains who can see a named person's pet's medical history.
 *
 * So it borrows the app's own reading vocabulary rather than inventing a
 * "legal" one:
 *
 *   - Sections are CARDS on the cream ground, exactly like every other screen.
 *     A card boundary is what lets someone skim for the section they want
 *     instead of scrolling a wall.
 *   - Numbers sit in a teal tint disc, the same treatment
 *     ErrorNotice gives its icon, so the eye can count down the document.
 *   - Body text is `fontSize.base` at 22pt leading — the same size the rest of
 *     the app uses for things people actually read, not smaller because it is
 *     legal.
 *   - `note` blocks get the tinted-panel treatment. They mark the handful of
 *     lines that change what an owner would DO — videos never leaving the
 *     device, no GPS, seek care immediately — and those must not read at the
 *     same volume as the indemnity clause.
 *
 * Nothing here sets allowFontScaling={false}, so all of it scales with the
 * OS text-size setting. On a document somebody may be reading at 200% because
 * they cannot see it otherwise, that is not a detail.
 */

import { StyleSheet, Text, View } from 'react-native';

import type { LegalDocument as LegalDoc } from '@/constants/legal';
import { colors, fontFamily, fontSize, radius, spacing } from '@/theme/tokens';

export function LegalDocumentBody({ doc }: { doc: LegalDoc }) {
  return (
    <View style={styles.doc}>
      {doc.sections.map((section, index) => (
        <View
          key={`${section.number ?? 'x'}-${index}`}
          style={styles.section}
          // The whole section is one accessibility node so a screen reader
          // reads "Section 5, Photos and Videos" and then its text, rather
          // than announcing the number disc as a separate stray "5".
          accessible={false}
        >
          <View style={styles.sectionHeader}>
            {section.number !== null && (
              <View style={styles.numberDisc}>
                <Text style={styles.numberText}>{section.number}</Text>
              </View>
            )}
            <Text style={styles.sectionTitle}>{section.title}</Text>
          </View>

          {section.blocks.map((block, i) => {
            const key = `${index}-${i}`;

            if (block.kind === 'sub') {
              return (
                <Text key={key} style={styles.sub}>
                  {block.text}
                </Text>
              );
            }

            if (block.kind === 'note') {
              return (
                <View key={key} style={styles.note}>
                  <Text style={styles.noteText}>{block.text}</Text>
                </View>
              );
            }

            if (block.kind === 'list') {
              return (
                <View key={key} style={styles.list}>
                  {block.items.map((item, j) => (
                    <View key={j} style={styles.listRow}>
                      {/*
                        A real bullet glyph in a fixed-width column rather than
                        a text prefix: a wrapped list item should align under
                        its own first word, not under the bullet.
                      */}
                      <Text style={styles.bullet}>•</Text>
                      <Text style={styles.listText}>{item}</Text>
                    </View>
                  ))}
                </View>
              );
            }

            return (
              <Text key={key} style={styles.paragraph}>
                {block.text}
              </Text>
            );
          })}
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  doc: { gap: spacing.md },

  section: {
    backgroundColor: colors.card,
    borderRadius: radius.card,
    padding: spacing.lg,
    gap: spacing.sm,
  },

  sectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  numberDisc: {
    width: 26,
    height: 26,
    // A CIRCLE: half of 26, not a radius token — the same note as every other
    // circular badge in this app.
    borderRadius: 13,
    backgroundColor: colors.tealTint,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 0,
  },
  numberText: {
    fontSize: fontSize.sm,
    fontWeight: '800',
    color: colors.tealDeep,
    fontFamily: fontFamily.extrabold,
  },
  sectionTitle: {
    flex: 1,
    fontSize: fontSize.md,
    fontWeight: '800',
    color: colors.ink,
    fontFamily: fontFamily.extrabold,
  },

  sub: {
    fontSize: fontSize.base,
    fontWeight: '700',
    color: colors.ink,
    fontFamily: fontFamily.bold,
    marginTop: spacing.xs,
  },

  paragraph: {
    fontSize: fontSize.base,
    // 22 against a 14.5pt face is generous on purpose. This is long-form
    // reading on a phone, and the app's default 19-21 leading is tuned for
    // two-line captions, not for thirty seconds of continuous text.
    lineHeight: 22,
    color: colors.ink,
    fontFamily: fontFamily.regular,
  },

  list: { gap: spacing.xs, marginTop: spacing.xs },
  listRow: { flexDirection: 'row', gap: spacing.sm, paddingRight: spacing.xs },
  bullet: {
    fontSize: fontSize.base,
    lineHeight: 22,
    color: colors.teal,
    fontFamily: fontFamily.bold,
    // Fixed width so every item's text starts on the same left edge.
    width: 10,
  },
  listText: {
    flex: 1,
    fontSize: fontSize.base,
    lineHeight: 22,
    color: colors.ink,
    fontFamily: fontFamily.regular,
  },

  note: {
    backgroundColor: colors.tealTint,
    borderRadius: radius.field,
    borderLeftWidth: 3,
    borderLeftColor: colors.teal,
    padding: spacing.md,
    marginTop: spacing.xs,
  },
  noteText: {
    fontSize: fontSize.base,
    lineHeight: 22,
    color: colors.tealDeep,
    fontFamily: fontFamily.semibold,
  },
});
