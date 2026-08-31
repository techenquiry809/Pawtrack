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

import { useEffect, useMemo, useState } from 'react';
import { Pressable, SectionList, StyleSheet, Text, View } from 'react-native';
import { useRouter } from 'expo-router';

import { Body, Button, Card, EmptyState, Muted, Pill } from '@/components/ui';
import { VideoTile } from '@/components/VideoTile';
import { colors, fontFamily, fontSize, spacing } from '@/theme/tokens';
import { dayLabel } from '@/features/timeline';
import { formatDuration, startOfDay } from '@/utils/time';
import type { GalleryEntry } from '@/types/domain';
import { deviceNames } from '@/services/sync/devices';

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

  /**
   * device_id → phone name, so a clip stored elsewhere can say WHICH phone
   * has it. Read from the local cache rather than the network: this screen
   * has to be right offline, which is exactly when the owner is trying to
   * work out where a recording went.
   */
  const [names, setNames] = useState<Record<string, string>>({});

  /**
   * Which clip has its description open.
   *
   * One at a time, and opened explicitly. The grid's job is scanning — an
   * owner looking for the clip to show their vet recognises it by its poster
   * frame, not by reading. Printing every description inline would turn two
   * columns of pictures into a wall of text and lose the thing the grid is
   * good at. So the detail is one tap away and closes when another opens.
   */
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    void deviceNames().then(setNames);
  }, []);

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
      renderItem={({ item }) => {
        const open = item.entries.find((e) => e && e.video.id === openId);
        return (
        <>
        <View style={styles.row}>
          {item.entries.map((entry, index) =>
            entry ? (
              <View key={entry.video.id} style={styles.cell}>
              <VideoTile
                thumbUri={entry.video.thumbUri}
                durationSec={entry.video.durationSec}
                isLocal={entry.video.isLocal}
                originDeviceName={
                  entry.video.originDeviceId
                    ? (names[entry.video.originDeviceId] ?? null)
                    : null
                }
                captureConfidence={entry.video.captureConfidence}
                caption={new Date(entry.video.timestamp).toLocaleTimeString(
                  undefined,
                  { hour: 'numeric', minute: '2-digit' },
                )}
                accessibilityLabel={describe(entry)}
                onPress={() => router.push(`/video/${entry.video.id}`)}
              />
              <Pressable
                onPress={() =>
                  setOpenId(openId === entry.video.id ? null : entry.video.id)
                }
                accessibilityRole="button"
                accessibilityState={{ expanded: openId === entry.video.id }}
                accessibilityLabel={
                  openId === entry.video.id
                    ? 'Hide description'
                    : 'Show description'
                }
                hitSlop={6}
                style={({ pressed }) => [styles.detailsBtn, pressed && styles.pressed]}
              >
                <Muted style={styles.detailsLabel}>
                  {openId === entry.video.id ? 'Hide details' : 'Details'}
                </Muted>
              </Pressable>
              </View>
            ) : (
              // Occupies a column so the real tiles keep their width.
              <View key={`gap-${index}`} style={styles.gap} />
            ),
          )}
        </View>
        {/* Full width, below the row rather than inside a column: a
            description squeezed into half the screen wraps every two words. */}
        {open ? <VideoDetails entry={open} /> : null}
        </>
        );
      }}
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

/**
 * What a clip actually shows, without leaving the grid.
 *
 * The phase notes are the point. `preNote`, `ictalNote` and `postNote` are the
 * owner's own words about what was happening before, during and after — the
 * part a vet reads — and until now they were only visible on the video's own
 * screen, one navigation away, which meant an owner comparing two clips had to
 * bounce in and out of the gallery to remember which was which.
 */
function VideoDetails({ entry }: { entry: GalleryEntry }) {
  const v = entry.video;
  const when = new Date(v.timestamp);
  const notes: { label: string; text: string }[] = [
    { label: 'Before', text: v.preNote },
    { label: 'During', text: v.ictalNote },
    { label: 'After', text: v.postNote },
    { label: 'Note', text: v.note },
  ].filter((n) => n.text.trim().length > 0);

  return (
    <Card style={styles.details}>
      <View style={styles.detailsHead}>
        <Body style={styles.detailsWhen}>
          {when.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
          {', '}
          {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
        </Body>
        <Pill
          label={v.durationSec ? formatDuration(v.durationSec) : 'Length unknown'}
          tone={v.durationSec ? 'teal' : 'neutral'}
        />
      </View>

      <DetailRow
        label="Seizure"
        value={
          entry.seizureDurationSec > 0
            ? `${formatDuration(entry.seizureDurationSec)}${
                entry.seizureDurationConfidence === 'unreliable' ? ', owner-stated' : ''
              }`
            : 'Not timed'
        }
      />
      <DetailRow
        label="Observations"
        value={
          entry.observationCount > 0
            ? `${entry.observationCount} recorded`
            : 'None recorded'
        }
      />
      {entry.retrospective ? (
        <DetailRow label="Logged" value="After the fact, from memory" />
      ) : null}

      {notes.length > 0 ? (
        <View style={styles.notes}>
          {notes.map((n) => (
            <View key={n.label} style={styles.noteRow}>
              <Muted style={styles.noteLabel}>{n.label}</Muted>
              <Body style={styles.noteText}>{n.text}</Body>
            </View>
          ))}
        </View>
      ) : (
        <Muted style={styles.notes}>
          No description was written for this clip.
        </Muted>
      )}
    </Card>
  );
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <View style={styles.detailRow}>
      <Muted style={styles.detailLabel}>{label}</Muted>
      <Body style={styles.detailValue}>{value}</Body>
    </View>
  );
}

const styles = StyleSheet.create({
  cell: { flex: 1 },
  pressed: { opacity: 0.7 },
  detailsBtn: { alignItems: 'center', paddingTop: 6, minHeight: 28 },
  detailsLabel: { fontSize: fontSize.xs, fontFamily: fontFamily.semibold, color: colors.tealDeep },
  details: { marginBottom: spacing.sm },
  detailsHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    marginBottom: spacing.sm,
  },
  detailsWhen: { fontFamily: fontFamily.bold },
  detailRow: { flexDirection: 'row', gap: spacing.md, paddingVertical: 3 },
  detailLabel: { width: 96 },
  detailValue: { flex: 1 },
  notes: { marginTop: spacing.sm, gap: spacing.sm },
  noteRow: { gap: 1 },
  noteLabel: { fontSize: fontSize.xs },
  noteText: {},
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
    fontFamily: fontFamily.extrabold
  },
  row: { flexDirection: 'row', gap: spacing.sm, marginBottom: spacing.sm },
  gap: { flex: 1 },
});
