/**
 * The video gallery — every recording this dog has, by the day it happened.
 *
 * ── GROUPED BY WHEN IT HAPPENED, NOT WHEN IT WAS ADDED ────────────────
 *
 * This is the whole point of migration 8. A clip filmed on Tuesday and
 * imported on Friday belongs under Tuesday, next to the check-in and the doses
 * from that day — that is the question an owner is asking when they open a
 * gallery ("what happened that day?"). Grouping by import date would file it
 * under Friday, where it means nothing.
 *
 * ── THE TILE IS A DOORWAY, NOT A PLAYER ───────────────────────────────
 *
 * Tapping a tile opens the video screen, which plays the clip AND shows the
 * full record it belongs to. Inline playback in a grid was considered and
 * rejected: a wall of autoplaying seizure footage is the last thing an owner
 * scrolling their history needs to be ambushed by.
 */

import { useMemo } from 'react';
import { SectionList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Button, Card, EmptyState, Muted, Pill } from '@/components/ui';
import { VideoTile } from '@/components/VideoTile';
import { colors, fontSize, spacing } from '@/theme/tokens';
import { dayLabel } from '@/features/timeline';
import { formatDuration, startOfDay } from '@/utils/time';
import type { GalleryEntry } from '@/types/domain';

const COLUMNS = 3;

type Row = { key: string; entries: (GalleryEntry | null)[] };
type Section = { title: string; count: number; data: Row[] };

/**
 * Groups entries into day sections of fixed-width rows.
 *
 * The last row is padded with nulls rather than left short. Without that, a
 * day with four videos renders one full row and one row whose single tile
 * stretches to the full screen width, which reads as a different kind of item.
 */
function buildSections(entries: GalleryEntry[], now: number): Section[] {
  const byDay = new Map<number, GalleryEntry[]>();

  for (const entry of entries) {
    const day = startOfDay(entry.video.timestamp);
    const bucket = byDay.get(day);
    if (bucket) bucket.push(entry);
    else byDay.set(day, [entry]);
  }

  return [...byDay.entries()]
    .sort((a, b) => b[0] - a[0])
    .map(([day, dayEntries]) => {
      const rows: Row[] = [];
      for (let i = 0; i < dayEntries.length; i += COLUMNS) {
        const slice: (GalleryEntry | null)[] = dayEntries.slice(i, i + COLUMNS);
        while (slice.length < COLUMNS) slice.push(null);
        rows.push({ key: `${day}-${i}`, entries: slice });
      }
      return {
        title: dayLabel(day, now),
        count: dayEntries.length,
        data: rows,
      };
    });
}

export function VideoGallery({
  entries,
  loaded,
  dogName,
  contentPaddingTop,
  contentPaddingBottom,
  header,
}: {
  entries: GalleryEntry[];
  loaded: boolean;
  dogName: string;
  contentPaddingTop: number;
  contentPaddingBottom: number;
  header?: React.ReactElement;
}) {
  const router = useRouter();
  const sections = useMemo(() => buildSections(entries, Date.now()), [entries]);

  return (
    <SectionList
      sections={sections}
      keyExtractor={(row) => row.key}
      stickySectionHeadersEnabled={false}
      contentContainerStyle={[
        styles.content,
        { paddingTop: contentPaddingTop, paddingBottom: contentPaddingBottom },
      ]}
      ListHeaderComponent={header}
      renderSectionHeader={({ section }) => (
        <View style={styles.dayHeader}>
          <Text style={styles.dayTitle}>{section.title}</Text>
          <Muted>
            {section.count} video{section.count === 1 ? '' : 's'}
          </Muted>
        </View>
      )}
      renderItem={({ item }) => (
        <View style={styles.row}>
          {item.entries.map((entry, index) =>
            entry ? (
              <VideoTile
                key={entry.video.id}
                thumbUri={entry.video.thumbUri}
                durationSec={entry.video.durationSec}
                captureConfidence={entry.video.captureConfidence}
                caption={new Date(entry.video.timestamp).toLocaleTimeString(
                  undefined,
                  { hour: 'numeric', minute: '2-digit' },
                )}
                accessibilityLabel={describe(entry)}
                onPress={() => router.push(`/video/${entry.video.id}`)}
              />
            ) : (
              // Occupies a column so the real tiles keep their width.
              <View key={`gap-${index}`} style={styles.gap} />
            ),
          )}
        </View>
      )}
      ListEmptyComponent={
        <Card>
          {!loaded ? (
            <Muted>Reading videos…</Muted>
          ) : (
            <>
              <EmptyState
                icon="camera"
                title="No videos yet"
                body={`Film a seizure from the timer screen, or add one you already have on your phone. A short clip is often the single most useful thing you can bring ${dogName}'s vet.`}
              />
              <Button
                label="Add a video you already have"
                variant="ghost"
                onPress={() => router.push('/add-video')}
                style={{ marginTop: spacing.md }}
              />
            </>
          )}
        </Card>
      }
    />
  );
}

/** Screen-reader description. Says what it is before how long it was. */
function describe(entry: GalleryEntry): string {
  const when = new Date(entry.video.timestamp).toLocaleString(undefined, {
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
  const length =
    entry.video.durationSec && entry.video.durationSec > 0
      ? `, ${formatDuration(entry.video.durationSec)} long`
      : '';
  const stated =
    entry.video.captureConfidence === 'owner_stated'
      ? ', date entered by you'
      : entry.video.captureConfidence === 'unknown'
        ? ', date unknown'
        : '';
  return `Seizure video from ${when}${length}${stated}`;
}

/**
 * The filter strip above the grid. Lives here rather than in the Records
 * screen so the gallery owns its own controls.
 */
export function GalleryHeader({
  total,
  imported,
  onAdd,
}: {
  total: number;
  imported: number;
  onAdd: () => void;
}) {
  return (
    <View style={styles.header}>
      <View style={styles.headerRow}>
        <Muted>
          {total} video{total === 1 ? '' : 's'}
        </Muted>
        {imported > 0 ? (
          <Pill label={`${imported} added by you`} tone="amber" />
        ) : null}
      </View>
      <Button label="Add a video" variant="ghost" onPress={onAdd} />
    </View>
  );
}

const styles = StyleSheet.create({
  content: { paddingHorizontal: spacing.lg },
  header: { gap: spacing.sm, marginBottom: spacing.sm },
  headerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  dayHeader: {
    flexDirection: 'row',
    alignItems: 'baseline',
    justifyContent: 'space-between',
    marginTop: spacing.lg,
    marginBottom: spacing.sm,
  },
  dayTitle: {
    fontSize: fontSize.xs,
    fontWeight: '800',
    letterSpacing: 1.1,
    textTransform: 'uppercase',
    color: colors.inkSoft,
  },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  gap: { flex: 1 },
});
