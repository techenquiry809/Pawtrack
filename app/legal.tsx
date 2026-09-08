/**
 * Reading the Terms or the Privacy Policy in full.
 *
 * One screen for both documents, selected by the `doc` search param, because
 * they differ only in content — two near-identical screens would drift the
 * moment one got a fix the other did not.
 *
 * Reached from two places, and both matter:
 *   - the consent gate, before anything has been agreed to
 *   - Settings → About, forever afterwards
 *
 * The second is the one people forget to build. An agreement you can only read
 * at the moment you are being asked to accept it is not one anybody can go
 * back and check, and "what did I agree to?" is a reasonable question six
 * months later.
 */

import { ScrollView, StyleSheet, View } from 'react-native';
import { useLocalSearchParams } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { BackButton } from '@/components/BackButton';
import { LegalDocumentBody } from '@/components/LegalDocument';
import { Muted, Title } from '@/components/ui';
import { legalDocument, type LegalDocument } from '@/constants/legal';
import { colors, spacing } from '@/theme/tokens';

export default function LegalScreen() {
  const insets = useSafeAreaInsets();
  const { doc } = useLocalSearchParams<{ doc?: string }>();

  // Defaults to the Terms rather than throwing on a bad or missing param:
  // this screen is reachable by deep link, and a crash is a worse answer to a
  // typo'd URL than showing the first document.
  const id: LegalDocument['id'] = doc === 'privacy' ? 'privacy' : 'terms';
  const document = legalDocument(id);

  return (
    <View style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          styles.content,
          {
            paddingTop: insets.top + spacing.md,
            paddingBottom: insets.bottom + spacing.xl,
          },
        ]}
        showsVerticalScrollIndicator={false}
      >
        <BackButton />

        <View style={styles.header}>
          <Title>{document.title}</Title>
          <Muted>Last updated {document.updated}</Muted>
        </View>

        <LegalDocumentBody doc={document} />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, gap: spacing.md },
  header: { gap: spacing.xs, marginBottom: spacing.xs },
});
