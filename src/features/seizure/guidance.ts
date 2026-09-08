/**
 * What to tell the owner, second by second, while a seizure is being timed.
 *
 * ── WHY THIS IS A TABLE AND NOT PROSE IN THE SCREEN ───────────────────
 *
 * Because it is the only thing on that screen a person will actually read,
 * and it has to be reviewable as a whole. Someone checking this copy — the
 * owner of the app, a vet, whoever signs off on it — needs to see the entire
 * sequence in one place, in order, with its timings, not scattered through a
 * render function between animation code.
 *
 * It also has to be testable, and this file imports nothing so that `npm test`
 * (node's native type stripping, no bundler, no mocks) can reach it. Same
 * reasoning as src/utils/clock.ts.
 *
 * ── THE ONE RULE THE TABLE ITSELF ENFORCES ────────────────────────────
 *
 * Steps are ordered and contiguous, and the last one has no end. Elapsed time
 * on this screen is derived from an absolute mark and can JUMP — the phone
 * suspends the JS thread and the next render is ninety seconds later (see
 * useSeizureTimer). So the lookup is a range search over the whole table, not
 * a cursor that advances one step at a time. A cursor would sit on "Stay
 * Calm" for a seizure that had been running four minutes.
 *
 * ── WHAT THIS IS NOT ──────────────────────────────────────────────────
 *
 * Not a clinical protocol, and it does not decide anything. The formal alerts
 * are still the threshold banners on the live screen, which fire at the
 * owner's OWN configured warn and critical minutes (settings.thresholdWarnMin
 * / thresholdCritMin). This is steadying, general first-aid guidance on a
 * fixed schedule, and it is deliberately never the only thing that says a
 * seizure has gone long.
 */

export type GuidanceStep = {
  /** Inclusive lower bound, in seconds since the seizure was marked. */
  fromSec: number;
  /** Exclusive upper bound. `null` on the final step, which never ends. */
  toSec: number | null;
  /** Rendered large, above the line. */
  title: string;
  /** One sentence. Kept short enough to read at a glance, in bad light. */
  body: string;
  /**
   * Leading glyph. Decorative — every step reads correctly without it, which
   * matters because emoji coverage varies by device font.
   */
  glyph: string;
  /**
   * How loudly the step is drawn.
   *
   *   calm     the first minute: reassurance and the do-nots
   *   caution  it has gone longer than usual
   *   urgent   the five-minute mark, where the advice becomes "call someone"
   */
  tone: 'calm' | 'caution' | 'urgent';
};

const MIN = 60;

/**
 * The step that never ends.
 *
 * Named, rather than written inline at the end of the table, so `guidanceAt`'s
 * unreachable fallback can return THIS object instead of indexing the array
 * for its last element — which the compiler cannot know is there, and which
 * would be the wrong thing to guess about on this screen anyway.
 */
const EMERGENCY: GuidanceStep = {
  fromSec: 5 * 60,
  toSec: null,
  glyph: '🚨',
  tone: 'urgent',
  title: '5 Minutes — Emergency',
  body: 'Contact an emergency veterinarian immediately.',
};

/**
 * The schedule. Contiguous by construction, and asserted to be so by the
 * tests — a gap here would render nothing at all for those seconds.
 *
 * Typed as a non-empty tuple so `GUIDANCE[0]` is a step rather than a maybe.
 */
export const GUIDANCE: readonly [GuidanceStep, ...GuidanceStep[]] = [
  // ── The first minute: five-second beats. Most seizures end inside it,
  //    and this is where an owner is least able to think for themselves.
  { fromSec: 0, toSec: 5, glyph: '🧘', tone: 'calm',
    title: 'Stay Calm', body: 'Your calm presence helps.' },
  { fromSec: 5, toSec: 10, glyph: '🛡️', tone: 'calm',
    title: 'Make the Area Safe', body: 'Move sharp or dangerous objects away.' },
  { fromSec: 10, toSec: 15, glyph: '🚫', tone: 'calm',
    title: 'Don’t Hold Him Down', body: 'Let the seizure run its course.' },
  { fromSec: 15, toSec: 20, glyph: '🔇', tone: 'calm',
    title: 'Keep Things Calm', body: 'Don’t panic or crowd him.' },
  { fromSec: 20, toSec: 25, glyph: '🤫', tone: 'calm',
    title: 'Don’t Call His Name', body: 'Keep noise and stimulation low.' },
  { fromSec: 25, toSec: 30, glyph: '⚠️', tone: 'calm',
    title: 'Don’t Move Him', body: 'Move him only if he’s in danger.' },
  // Ten-second beats from here: the advice is settling in and a message that
  // changes every five seconds starts to read as flicker rather than help.
  { fromSec: 30, toSec: 40, glyph: '🦷', tone: 'calm',
    title: 'Keep Your Hands Away',
    body: 'Never put your hand or anything in his mouth.' },
  { fromSec: 40, toSec: 50, glyph: '🍖', tone: 'calm',
    title: 'No Food or Water', body: 'Wait until the seizure is completely over.' },
  { fromSec: 50, toSec: 1 * MIN, glyph: '👀', tone: 'calm',
    title: 'Stay Nearby', body: 'Monitor his breathing and keep him safe.' },

  // ── Past a minute, half-minute beats.
  { fromSec: 1 * MIN, toSec: 90, glyph: '💙', tone: 'calm',
    title: 'You’re Doing Okay',
    body: 'Stay calm and keep the area quiet and safe.' },
  { fromSec: 90, toSec: 2 * MIN, glyph: '👀', tone: 'calm',
    title: 'Keep Watching',
    body: 'Continue timing the seizure and monitor his breathing.' },

  { fromSec: 2 * MIN, toSec: 150, glyph: '⚠️', tone: 'caution',
    title: 'This Is Taking Longer',
    body: 'Stay calm. Keep him safe and be prepared to contact your veterinarian.' },
  { fromSec: 150, toSec: 3 * MIN, glyph: '📞', tone: 'caution',
    title: 'Be Prepared',
    body: 'Keep your veterinarian or emergency vet’s number nearby.' },

  { fromSec: 3 * MIN, toSec: 210, glyph: '🚨', tone: 'caution',
    title: 'Stay Alert',
    body: 'The seizure is lasting longer than usual. Keep watching closely and be ready to call your vet.' },
  { fromSec: 210, toSec: 4 * MIN, glyph: '📞', tone: 'caution',
    title: 'Get Ready to Call',
    body: 'Continue monitoring. Have your vet’s number ready.' },

  { fromSec: 4 * MIN, toSec: 270, glyph: '🚨', tone: 'urgent',
    title: 'Approaching 5 Minutes',
    body: 'Stay calm. Keep monitoring and prepare to contact an emergency veterinarian.' },
  { fromSec: 270, toSec: 5 * MIN, glyph: '🚨', tone: 'urgent',
    title: 'Almost 5 Minutes',
    body: 'Stay with him and be ready to call an emergency veterinarian immediately.' },

  // ── The last step never ends. A seizure can run for a long time, and the
  //    advice does not change after this point: it is already "call someone".
  EMERGENCY,
];

/**
 * The step covering `elapsedSec`.
 *
 * Never returns undefined for a sane input: the table starts at 0 and its last
 * step is open-ended. A negative elapsed value — which a clock change can
 * briefly produce, see utils/clock.ts — clamps to the first step rather than
 * leaving the slot empty at the worst possible moment.
 */
export function guidanceAt(elapsedSec: number): GuidanceStep {
  if (!Number.isFinite(elapsedSec) || elapsedSec < 0) return GUIDANCE[0];
  for (const step of GUIDANCE) {
    if (elapsedSec >= step.fromSec && (step.toSec === null || elapsedSec < step.toSec)) {
      return step;
    }
  }
  // Unreachable while the table stays contiguous and open-ended; the tests
  // assert both. Falling back to the emergency step keeps the most urgent
  // advice on screen rather than none, if that ever stopped being true.
  return EMERGENCY;
}

/**
 * Index of the step covering `elapsedSec`.
 *
 * The UI animates on CHANGE of this, not on the value of the clock — the
 * message is re-rendered every second by the timer, and a transition keyed on
 * anything else would replay once per tick.
 */
export function guidanceIndexAt(elapsedSec: number): number {
  const step = guidanceAt(elapsedSec);
  return GUIDANCE.indexOf(step);
}
