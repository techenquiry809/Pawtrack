/**
 * Seizure detail.
 *
 * The read view of a single record: what was observed, how long it lasted, how
 * far the timing can be trusted, and what has been edited since.
 *
 * ── SCOPE ─────────────────────────────────────────────────────────────
 *
 * This is deliberately READ + DELETE, not yet an editor. It exists now because
 * three other surfaces were dead-ending into it — Timeline rows, History rows,
 * and the crash-recovery prompt's "finish this record" action all need
 * somewhere real to land. Field-level editing is the next increment and slots
 * into the same sections; `seizureRepo.updateSeizure` already takes a partial
 * patch with an audit-trail summary.
 *
 * Nothing here invents clinical framing. Duration confidence is shown as the
 * record's own provenance, not as a judgement of the seizure.
 */

import { useCallback, useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import {
  Body, Button, Card, Heading, Muted, Pill, SectionTitle, Title, type PillTone,
} from '@/components/ui';
import { colors, fontSize, spacing } from '@/theme/tokens';
import { goBackOrHome } from '@/utils/nav';
import * as seizureRepo from '@/db/seizureRepo';
import { deleteVideoFile } from '@/services/videoService';
import { formatDuration } from '@/utils/time';
import type { DurationConfidence, SeizureWithVideos } from '@/types/domain';

/** How the record was timed — provenance, not a clinical grade. */
const CONFIDENCE_COPY: Record<DurationConfidence, { label: string; tone: PillTone; blurb: string }> = {
  high: {
    label: 'Timed',
    tone: 'green',
    blurb: 'Timed live with the app. This duration is measured, not estimated.',
  },
  clock_corrected: {
    label: 'Timed',
    tone: 'green',
    blurb:
      "Timed live. Your phone's clock shifted during the recording, so the app used its steady internal timer instead — the duration is still measured.",
  },
  recovered: {
    label: 'Estimated',
    tone: 'amber',
    blurb:
      'The app closed before this record was finished, so the duration is an estimate based on when it was last updated. Treat it as a floor, not an exact figure.',
  },
  unreliable: {
    label: 'Not timed',
    tone: 'neutral',
    blurb:
      'No dependable duration was captured for this record. It is left blank rather than guessed.',
  },
  legacy: {
    label: 'Earlier record',
    tone: 'neutral',
    blurb: 'Recorded before the app tracked timing provenance.',
  },
};

export default function SeizureDetailScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const router = useRouter();
  const insets = useSafeAreaInsets();

  const [record, setRecord] = useState<SeizureWithVideos | null>(null);
  const [edits, setEdits] = useState<{ editedAt: number; summary: string }[]>([]);
  const [loaded, setLoaded] = useState(false);

  useFocusEffect(
    useCallback(() => {
      if (!id) return;
      let cancelled = false;
      (async () => {
        try {
          const [row, history] = await Promise.all([
            seizureRepo.getSeizure(id),
            seizureRepo.getEditHistory(id),
          ]);
          if (!cancelled) {
            setRecord(row);
            setEdits(history);
          }
        } catch (e) {
          console.error('[seizure-detail] load failed', e);
        } finally {
          if (!cancelled) setLoaded(true);
        }
      })();
      return () => {
        cancelled = true;
      };
    }, [id]),
  );

  const onDelete = () => {
    if (!record) return;
    Alert.alert(
      'Delete this record?',
      'It will be removed from your history, your patterns and any report. This cannot be undone.',
      [
        { text: 'Keep it', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: () => {
            void (async () => {
              try {
                // Files first: once the row is gone the paths are unreachable
                // and the videos would sit on the phone forever.
                for (const video of record.videos) deleteVideoFile(video.fileUri);
                await seizureRepo.deleteSeizure(record.id);
                goBackOrHome(router);
              } catch (e) {
                console.error('[seizure-detail] delete failed', e);
                Alert.alert('Could not delete', 'Nothing was removed. Please try again.');
              }
            })();
          },
        },
      ],
    );
  };

  if (!loaded) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}>
        <Muted>Loading…</Muted>
      </ScrollView>
    );
  }

  if (!record) {
    return (
      <ScrollView style={styles.screen} contentContainerStyle={[styles.content, { paddingTop: insets.top + spacing.md }]}>
        <Title>Record not found</Title>
        <Muted style={{ marginTop: spacing.sm }}>
          This seizure may have been deleted.
        </Muted>
        <Button label="Go back" variant="ghost" onPress={() => goBackOrHome(router)} style={{ marginTop: spacing.lg }} />
      </ScrollView>
    );
  }

  const confidence = CONFIDENCE_COPY[record.durationConfidence];
  const started = new Date(record.start);

  return (
    <ScrollView
      style={styles.screen}
      contentContainerStyle={[
        styles.content,
        { paddingTop: insets.top + spacing.md, paddingBottom: insets.bottom + spacing.xl },
      ]}
    >
      <Muted style={styles.eyebrow}>
        {started.toLocaleDateString(undefined, {
          weekday: 'long', day: 'numeric', month: 'long',
        })}
      </Muted>
      <Title>
        {started.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
      </Title>

      {/* --- Timing ------------------------------------------------- */}
      <Card style={{ marginTop: spacing.md }}>
        <View style={styles.row}>
          <Heading>Duration</Heading>
          <Pill label={confidence.label} tone={confidence.tone} />
        </View>
        <Text style={styles.duration}>
          {record.durationConfidence === 'unreliable' || record.durationSec === 0
            ? '—'
            : formatDuration(record.durationSec)}
        </Text>
        <Muted>{confidence.blurb}</Muted>

        {record.recoverySec !== null && (
          <Muted style={{ marginTop: spacing.sm }}>
            Back to normal after {formatDuration(record.recoverySec)}.
          </Muted>
        )}
        {record.timeSincePrevSec !== null && (
          <Muted style={{ marginTop: 4 }}>
            {formatDuration(record.timeSincePrevSec)} since the previous recorded seizure.
          </Muted>
        )}
        {record.retrospective && (
          <View style={{ marginTop: spacing.sm }}>
            <Pill label="Logged after the fact" tone="neutral" />
          </View>
        )}
      </Card>

      {/* --- Observations ------------------------------------------- */}
      <ObservationList title="Before" items={record.preIctalObs} note={record.preIctalNote} />
      <ObservationList
        title="During"
        items={record.ictalObs}
        extras={[
          record.awareness ? `Awareness: ${record.awareness}` : null,
          record.position ? `Position: ${record.position}` : null,
          ...record.autonomic.map((a) => a),
        ].filter((x): x is string => x !== null)}
      />
      <ObservationList
        title="After"
        items={record.postBehavior}
        extras={
          record.severityOwner
            ? [`Looked ${record.severityOwner.toLowerCase()} to you`]
            : []
        }
      />

      {/* --- Notes -------------------------------------------------- */}
      {record.notes.trim().length > 0 && (
        <>
          <SectionTitle>Notes</SectionTitle>
          <Card>
            <Body>{record.notes}</Body>
          </Card>
        </>
      )}

      {/* --- Videos ------------------------------------------------- */}
      {record.videos.length > 0 && (
        <>
          <SectionTitle>Video</SectionTitle>
          <Card>
            <Body>
              {record.videos.length} recording{record.videos.length === 1 ? '' : 's'} saved
              on this phone.
            </Body>
            <Muted style={{ marginTop: 4 }}>
              Playback arrives with the editor. The files are safe in the meantime.
            </Muted>
          </Card>
        </>
      )}

      {/* --- Audit trail -------------------------------------------- */}
      {edits.length > 0 && (
        <>
          <SectionTitle>Changes to this record</SectionTitle>
          <Card>
            {edits.map((e) => (
              <View key={`${e.editedAt}_${e.summary}`} style={styles.editRow}>
                <Muted>{e.summary}</Muted>
                <Muted>
                  {new Date(e.editedAt).toLocaleDateString(undefined, {
                    day: 'numeric', month: 'short',
                  })}
                </Muted>
              </View>
            ))}
          </Card>
        </>
      )}

      <Button
        label="Delete this record"
        variant="ghost"
        onPress={onDelete}
        accessibilityHint="Permanently removes this seizure from your history"
        style={{ marginTop: spacing.lg }}
      />
      <Muted style={styles.footNote}>
        Editing individual fields is coming. Nothing recorded here is lost in the
        meantime.
      </Muted>
    </ScrollView>
  );
}

/* ------------------------------------------------------------------ */

function ObservationList({
  title,
  items,
  note,
  extras = [],
}: {
  title: string;
  items: string[];
  note?: string;
  extras?: string[];
}) {
  const all = [...items, ...extras];
  const hasNote = note !== undefined && note.trim().length > 0;
  if (all.length === 0 && !hasNote) return null;

  return (
    <>
      <SectionTitle>{title}</SectionTitle>
      <Card>
        {all.length > 0 ? (
          <View style={styles.tagWrap}>
            {all.map((item) => (
              <View key={item} style={styles.tag}>
                <Text style={styles.tagText}>{item}</Text>
              </View>
            ))}
          </View>
        ) : null}
        {hasNote && (
          <Body style={all.length > 0 ? { marginTop: spacing.sm } : undefined}>{note}</Body>
        )}
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  content: { paddingHorizontal: spacing.lg },
  eyebrow: { fontWeight: '700', letterSpacing: 0.8, textTransform: 'uppercase' },
  row: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },

  duration: {
    fontSize: 40,
    fontWeight: '700',
    color: colors.ink,
    letterSpacing: -1,
    fontVariant: ['tabular-nums'],
    marginTop: 4,
    marginBottom: 6,
  },

  tagWrap: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.sm },
  tag: {
    backgroundColor: colors.bg,
    borderRadius: 100,
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderWidth: 1,
    borderColor: colors.line,
  },
  tagText: { fontSize: fontSize.sm, color: colors.ink, fontWeight: '600' },

  editRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.md,
    paddingVertical: 4,
  },
  footNote: { textAlign: 'center', marginTop: spacing.sm },
});
