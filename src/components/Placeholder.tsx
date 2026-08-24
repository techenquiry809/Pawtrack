/**
 * Placeholder screen scaffold.
 *
 * Used for screens whose architecture, route and data layer are in place but
 * whose UI has not been built yet. Each one names what still needs doing so
 * the remaining work is visible in the app itself, not just a backlog.
 *
 * Delete this component once every screen is implemented.
 */

import { ScrollView, StyleSheet } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Card, Muted, SectionTitle, Title } from '@/components/ui';
import { colors, spacing } from '@/theme/tokens';

export function Placeholder({
  title,
  summary,
  todo,
}: {
  title: string;
  summary: string;
  todo: string[];
}) {
  const insets = useSafeAreaInsets();
  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}
    >
      <Title>{title}</Title>
      <Card style={{ marginTop: spacing.md }}>
        <Muted>{summary}</Muted>
      </Card>
      <SectionTitle>Still to build</SectionTitle>
      <Card>
        {todo.map((item) => (
          <Muted key={item} style={styles.todo}>• {item}</Muted>
        ))}
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg, paddingBottom: spacing.xl },
  todo: { marginBottom: 6 },
});
