/**
 * The observation questionnaire, as reusable field groups.
 *
 * ── WHY THIS IS SHARED ────────────────────────────────────────────────
 *
 * Three screens ask the same questions:
 *
 *   app/seizure/live.tsx        during the seizure   (ictal only)
 *   app/seizure/post.tsx        right afterwards     (aftermath)
 *   app/seizure/from-video.tsx  from an imported clip (both)
 *
 * They previously each mapped over the option arrays themselves. That was fine
 * with two screens and became a liability with three: the vocabularies are
 * stored verbatim in the database, so a chip group that silently drifts out of
 * sync writes strings no other screen can read back.
 *
 * ── THE INTERFACE IS PLAIN VALUES, NOT THE STORE ──────────────────────
 *
 * post.tsx drives these from the zustand draft; from-video.tsx drives them
 * from local component state, because an import is not a live seizure and has
 * no business touching the active-seizure store. So these components take a
 * value object and three handlers, and know nothing about where the state
 * lives.
 */

import { Chip, ChipGroup, Muted } from '@/components/ui';
import { QuestionLabel, SectionRule, TextArea } from '@/components/form';
import {
  AUTONOMIC_OPTIONS,
  AWARENESS_OPTIONS,
  MOVEMENT_OPTIONS,
  POSITION_OPTIONS,
  POST_BEHAVIOR_OPTIONS,
  PRE_ICTAL_OPTIONS,
  SEVERITY_OPTIONS,
} from '@/types/domain';

/* ------------------------------------------------------------------ */
/* Shape                                                               */
/* ------------------------------------------------------------------ */

export type ObservationValue = {
  ictalObs: string[];
  awareness: string | null;
  autonomic: string[];
  position: string | null;
  preIctalObs: string[];
  preIctalNote: string;
  postBehavior: string[];
  severityOwner: string | null;
  notes: string;
};

export type MultiField = 'ictalObs' | 'autonomic' | 'preIctalObs' | 'postBehavior';
export type SingleField = 'awareness' | 'position' | 'severityOwner';
export type TextField = 'preIctalNote' | 'notes';

export type ObservationHandlers = {
  toggle: (field: MultiField, value: string) => void;
  setSingle: (field: SingleField, value: string | null) => void;
  setText: (field: TextField, value: string) => void;
};

type Props = {
  value: ObservationValue;
  on: ObservationHandlers;
};

export const EMPTY_OBSERVATIONS: ObservationValue = {
  ictalObs: [],
  awareness: null,
  autonomic: [],
  position: null,
  preIctalObs: [],
  preIctalNote: '',
  postBehavior: [],
  severityOwner: null,
  notes: '',
};

/* ------------------------------------------------------------------ */
/* Reusable chip blocks                                                */
/* ------------------------------------------------------------------ */

/**
 * A single-select group where tapping the selected chip clears it.
 *
 * Without that, an owner who taps "Staring" by mistake on a radio-style group
 * has no way back to "unanswered" — and on a form where every field is
 * optional, "unanswered" is a real and meaningful state that must stay
 * reachable.
 */
function SingleSelect({
  options,
  selected,
  onSelect,
}: {
  options: readonly string[];
  selected: string | null;
  onSelect: (value: string | null) => void;
}) {
  return (
    <ChipGroup>
      {options.map((option) => (
        <Chip
          key={option}
          label={option}
          selected={selected === option}
          onPress={() => onSelect(selected === option ? null : option)}
        />
      ))}
    </ChipGroup>
  );
}

function MultiSelect({
  options,
  selected,
  onToggle,
}: {
  options: readonly string[];
  selected: string[];
  onToggle: (value: string) => void;
}) {
  return (
    <ChipGroup>
      {options.map((option) => (
        <Chip
          key={option}
          label={option}
          selected={selected.includes(option)}
          onPress={() => onToggle(option)}
        />
      ))}
    </ChipGroup>
  );
}

/* ------------------------------------------------------------------ */
/* What happened during the seizure                                    */
/* ------------------------------------------------------------------ */

/**
 * The ictal block — what the seizure itself looked like.
 *
 * Ordered movement → awareness → autonomic → position, which is the order an
 * owner watching a seizure actually perceives things in. It is not alphabetical
 * and should not be made so.
 */
/* ------------------------------------------------------------------ */
/* One question at a time                                              */
/* ------------------------------------------------------------------ */

/**
 * The same questions, exposed individually so a screen can put each on its own
 * step.
 *
 * Split out rather than copied into the stepped screens, for the reason this
 * file already exists: the option arrays must have exactly one home. Three
 * screens holding three copies of MOVEMENT_OPTIONS is a drift waiting to
 * happen, and a drifted option list means two records that describe the same
 * thing with different words.
 *
 * The grouped `IctalFields` / `AftermathFields` below stay for the screens
 * that genuinely want everything at once.
 */
export function MovementField({ value, on }: Props) {
  return (
    <MultiSelect
      options={MOVEMENT_OPTIONS}
      selected={value.ictalObs}
      onToggle={(o) => on.toggle('ictalObs', o)}
    />
  );
}

export function AwarenessField({ value, on }: Props) {
  return (
    <SingleSelect
      options={AWARENESS_OPTIONS}
      selected={value.awareness}
      onSelect={(o) => on.setSingle('awareness', o)}
    />
  );
}

export function AutonomicField({ value, on }: Props) {
  return (
    <MultiSelect
      options={AUTONOMIC_OPTIONS}
      selected={value.autonomic}
      onToggle={(o) => on.toggle('autonomic', o)}
    />
  );
}

export function PositionField({ value, on }: Props) {
  return (
    <SingleSelect
      options={POSITION_OPTIONS}
      selected={value.position}
      onSelect={(o) => on.setSingle('position', o)}
    />
  );
}

export function PostBehaviorField({ value, on }: Props) {
  return (
    <MultiSelect
      options={POST_BEHAVIOR_OPTIONS}
      selected={value.postBehavior}
      onToggle={(o) => on.toggle('postBehavior', o)}
    />
  );
}

export function PreIctalField({ value, on }: Props) {
  return (
    <>
      <MultiSelect
        options={PRE_ICTAL_OPTIONS}
        selected={value.preIctalObs}
        onToggle={(o) => on.toggle('preIctalObs', o)}
      />
      <TextArea
        value={value.preIctalNote}
        onChangeText={(t) => on.setText('preIctalNote', t)}
        placeholder="Anything else you noticed beforehand (optional)"
        accessibilityLabel="Notes about what you noticed before the seizure"
      />
    </>
  );
}

export function SeverityField({ value, on }: Props) {
  return (
    <SingleSelect
      options={SEVERITY_OPTIONS}
      selected={value.severityOwner}
      onSelect={(o) => on.setSingle('severityOwner', o)}
    />
  );
}

export function NotesField({ value, on }: Props) {
  return (
    <TextArea
      tall
      value={value.notes}
      onChangeText={(t) => on.setText('notes', t)}
      placeholder="Anything you want to remember or tell your vet (optional)"
      accessibilityLabel="Notes about this seizure"
    />
  );
}

export function IctalFields({ value, on }: Props) {
  return (
    <>
      <SectionRule label="Movement" count={value.ictalObs.length} />
      <MultiSelect
        options={MOVEMENT_OPTIONS}
        selected={value.ictalObs}
        onToggle={(option) => on.toggle('ictalObs', option)}
      />

      <SectionRule label="Awareness" count={value.awareness ? 1 : 0} />
      <SingleSelect
        options={AWARENESS_OPTIONS}
        selected={value.awareness}
        onSelect={(option) => on.setSingle('awareness', option)}
      />

      <SectionRule label="Autonomic signs" count={value.autonomic.length} />
      <MultiSelect
        options={AUTONOMIC_OPTIONS}
        selected={value.autonomic}
        onToggle={(option) => on.toggle('autonomic', option)}
      />

      <SectionRule label="Body position" count={value.position ? 1 : 0} />
      <SingleSelect
        options={POSITION_OPTIONS}
        selected={value.position}
        onSelect={(option) => on.setSingle('position', option)}
      />
    </>
  );
}

/* ------------------------------------------------------------------ */
/* What happened around the seizure                                    */
/* ------------------------------------------------------------------ */

/**
 * The aftermath block — before, after, and the owner's own read of it.
 *
 * `dogName` is threaded through rather than read from the store so this stays
 * usable from the import flow, where the record being written may belong to a
 * dog other than the active one in a future multi-dog build.
 */
export function AftermathFields({
  value,
  on,
  dogName,
}: Props & { dogName: string }) {
  return (
    <>
      <QuestionLabel>How is {dogName} behaving now?</QuestionLabel>
      <MultiSelect
        options={POST_BEHAVIOR_OPTIONS}
        selected={value.postBehavior}
        onToggle={(option) => on.toggle('postBehavior', option)}
      />

      <QuestionLabel hint="Warning signs in the minutes or hours before it started.">
        Anything unusual beforehand?
      </QuestionLabel>
      <MultiSelect
        options={PRE_ICTAL_OPTIONS}
        selected={value.preIctalObs}
        onToggle={(option) => on.toggle('preIctalObs', option)}
      />
      <TextArea
        value={value.preIctalNote}
        onChangeText={(text) => on.setText('preIctalNote', text)}
        placeholder="Anything else you noticed beforehand (optional)"
        accessibilityLabel="Notes about what you noticed before the seizure"
      />

      <QuestionLabel hint="Your own impression, not a clinical grade. Your vet reads it alongside the timing and the video.">
        How did it look to you?
      </QuestionLabel>
      <SingleSelect
        options={SEVERITY_OPTIONS}
        selected={value.severityOwner}
        onSelect={(option) => on.setSingle('severityOwner', option)}
      />

      <QuestionLabel>Notes</QuestionLabel>
      <TextArea
        tall
        value={value.notes}
        onChangeText={(text) => on.setText('notes', text)}
        placeholder="Anything you want to remember or tell your vet (optional)"
        accessibilityLabel="Notes about this seizure"
      />
      <Muted style={{ marginTop: 6 }}>
        Everything on this screen is optional and stays editable later.
      </Muted>
    </>
  );
}
