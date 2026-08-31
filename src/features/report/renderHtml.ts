/**
 * The printed document.
 *
 * ── ESCAPING IS THE WHOLE SECURITY MODEL OF THIS FILE ─────────────────
 *
 * `src/types/domain.ts` already carries the warning, on the breed field:
 *
 *   "When that report ships as HTML through expo-print, this value must ALSO
 *    be escaped at render — an unescaped `<` in a PDF template is an injection
 *    vector, and a length cap alone does not close it."
 *
 * Owner-controlled strings reaching this file include the dog's name, breed
 * description, seizure notes, medication names, clinic names and per-clip video
 * notes. Every one of them goes through `esc()`. The rule enforced here is
 * mechanical rather than a matter of judgement: interpolation into the template
 * is only ever `${esc(...)}` or a number this module computed itself. If a new
 * field is added and someone forgets, the injection test in renderHtml.test.ts
 * is what catches it.
 *
 * ── WHY HTML AND NOT A PDF LIBRARY ────────────────────────────────────
 *
 * `expo-print` takes HTML and returns a PDF. That is the whole pipeline, and
 * it means this module is a pure string function — which is why it can be
 * tested at all. No layout engine, no native calls, no async.
 *
 * Pure. Types-only imports so `node --test` can load it.
 */

import type { DoseWithName, SeizureWithClips } from './collect';
import type { ReportSummary } from './summarize';
import type { ReportRange } from './range';

/* ------------------------------------------------------------------ */
/* Escaping                                                            */
/* ------------------------------------------------------------------ */

/**
 * Make an owner-supplied string safe to interpolate into HTML.
 *
 * Ampersand FIRST. Escaping it after the others would double-escape the
 * entities this function just produced, turning `&lt;` into `&amp;lt;` and
 * printing the literal text "&lt;" in the vet's PDF.
 *
 * Quotes are escaped as well as angle brackets: some values land in attribute
 * position (an `alt`, a `src`), where a bare quote breaks out of the attribute
 * without ever needing a `<`.
 */
export function esc(value: unknown): string {
  if (value === null || value === undefined) return '';
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/* ------------------------------------------------------------------ */
/* Small formatters                                                    */
/* ------------------------------------------------------------------ */

/** `2m 04s`, or an em dash when there is nothing trustworthy to show. */
export function fmtDuration(sec: number | null | undefined): string {
  if (sec === null || sec === undefined || sec <= 0) return '—';
  const m = Math.floor(sec / 60);
  const s = Math.round(sec % 60);
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`;
}

/** `08:14`, in the local time of whoever is reading. */
export function fmtClock(epochMs: number): string {
  const d = new Date(epochMs);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

export function fmtDateTime(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}, ${fmtClock(epochMs)}`;
}

/**
 * How much to trust a seizure's timing, in the reader's words.
 *
 * Printed on every entry rather than only on the untrusted ones. A marker that
 * appeared only when something was wrong would make its absence ambiguous —
 * the reader could not tell "measured" from "nobody has looked at this yet".
 */
export function timingNote(s: {
  durationConfidence: string;
  retrospective: boolean;
}): string {
  if (s.retrospective) return 'logged later, from memory';
  if (s.durationConfidence === 'unreliable') return 'timing not dependable';
  if (s.durationConfidence === 'clock_corrected') return 'timed live, clock corrected';
  if (s.durationConfidence === 'recovered') return 'timed live, recovered after interruption';
  return 'timed live';
}

/** Join a list of observations, or say plainly that none were recorded. */
function list(values: readonly string[] | null | undefined): string {
  if (!values || values.length === 0) return '<span class="none">none recorded</span>';
  return values.map((v) => esc(v)).join(', ');
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

function renderSeizure(s: SeizureWithClips, index: number): string {
  const recovery = s.recoverySec && s.recoverySec > 0
    ? `<div class="row"><span class="k">Recovery</span><span class="v">${esc(fmtDuration(s.recoverySec))}</span></div>`
    : '';

  const notes = s.notes
    ? `<div class="row"><span class="k">Notes</span><span class="v">${esc(s.notes)}</span></div>`
    : '';

  const clips = s.videos.length > 0
    ? `<div class="clips">${s.videos.map((v, i) => `
        <div class="clip">
          ${v.thumbUri ? `<img src="${esc(v.thumbUri)}" alt="Still from video ${i + 1}" />` : '<div class="noshot"></div>'}
          <div class="clipmeta">
            <strong>Video ${i + 1} of ${s.videos.length}</strong>
            <span>${esc(fmtClock(v.timestamp))} · ${esc(fmtDuration(v.durationSec))}</span>
            ${v.preNote ? `<span class="cn">Before: ${esc(v.preNote)}</span>` : ''}
            ${v.ictalNote ? `<span class="cn">During: ${esc(v.ictalNote)}</span>` : ''}
            ${v.postNote ? `<span class="cn">After: ${esc(v.postNote)}</span>` : ''}
          </div>
        </div>`).join('')}</div>`
    : '';

  return `
  <article class="seizure">
    <header>
      <span class="idx">${index + 1}</span>
      <span class="time">${esc(fmtClock(s.start))}</span>
      <span class="dur">${esc(fmtDuration(s.durationSec))}</span>
      <span class="conf">${esc(timingNote(s))}</span>
    </header>
    <div class="row"><span class="k">Before</span><span class="v">${list(s.preIctalObs)}</span></div>
    ${s.preIctalNote ? `<div class="row"><span class="k"></span><span class="v">${esc(s.preIctalNote)}</span></div>` : ''}
    <div class="row"><span class="k">During</span><span class="v">${list(s.ictalObs)}</span></div>
    <div class="row"><span class="k">Awareness</span><span class="v">${esc(s.awareness ?? '—')}</span></div>
    <div class="row"><span class="k">After</span><span class="v">${list(s.postBehavior)}</span></div>
    ${recovery}
    ${s.severityOwner ? `<div class="row"><span class="k">Owner severity</span><span class="v">${esc(s.severityOwner)}</span></div>` : ''}
    ${notes}
    ${clips}
  </article>`;
}

function renderDoses(rows: DoseWithName[]): string {
  if (rows.length === 0) return '<p class="none">No medication recorded in this period.</p>';
  return `
  <table class="doses">
    <thead><tr><th>Day</th><th>Time</th><th>Medication</th><th>Status</th></tr></thead>
    <tbody>${rows.map((d) => `
      <tr>
        <td>${esc(d.doseDate)}</td>
        <td>${esc(d.scheduledHHMM ?? '—')}</td>
        <td>${esc(d.medicationName ?? 'Medication no longer listed')}</td>
        <td class="s-${esc(d.status)}">${esc(d.status)}</td>
      </tr>`).join('')}</tbody>
  </table>`;
}

function renderDayStrip(summary: ReportSummary): string {
  if (summary.range.scope !== 'week') return '';
  const peak = Math.max(1, ...summary.days.map((d) => d.seizureCount));
  return `
  <div class="strip">${summary.days.map((d) => {
    const h = Math.round((d.seizureCount / peak) * 34);
    return `<div class="bar">
      <div class="fill" style="height:${d.seizureCount > 0 ? Math.max(h, 4) : 1}px"></div>
      <span class="n">${d.seizureCount}</span>
      <span class="d">${esc(d.dayKey.slice(8))}</span>
    </div>`;
  }).join('')}</div>`;
}

/* ------------------------------------------------------------------ */
/* The document                                                        */
/* ------------------------------------------------------------------ */

export type RenderInput = {
  summary: ReportSummary;
  dogName: string;
  breedLabel: string;
  rangeLabel: string;
  /** Shown in the footer so a reader can find the app. */
  appUrl?: string;
};

export function renderReportHtml(input: RenderInput): string {
  const { summary, dogName, breedLabel, rangeLabel } = input;
  const d = summary.duration;

  // The denominator sentence. Printed whenever ANYTHING was excluded, because
  // a median over 4 of 6 events read as a median over 6 is the single most
  // misleading thing this document could do.
  //
  // Two wordings, because "the median of 0 reliably timed seizures" is not a
  // sentence. When nothing was usable there is no statistic to qualify — the
  // dashes above need explaining instead, or a reader assumes the export is
  // broken rather than that the app declined to vouch for the numbers.
  let caveat = '';
  if (d.excludedCount > 0 && d.usableCount === 0) {
    caveat = `<p class="caveat">No seizure in this period had timing dependable enough
      to measure, so no duration figures are shown.
      ${d.excludedCount === 1 ? 'The record is' : `All ${d.excludedCount} records are`}
      still listed below, with what was recorded.</p>`;
  } else if (d.excludedCount > 0) {
    caveat = `<p class="caveat">Figures are the median and total of ${d.usableCount}
      reliably timed ${d.usableCount === 1 ? 'seizure' : 'seizures'}, not the average.
      ${d.excludedCount} ${d.excludedCount === 1 ? 'record had' : 'records had'}
      no dependable timing and ${d.excludedCount === 1 ? 'was' : 'were'} left out of the
      figures. ${d.excludedCount === 1 ? 'It is' : 'They are'} still listed below.</p>`;
  }

  const body = summary.seizureCount === 0
    ? `<p class="quiet">No seizures were recorded in this period.</p>`
    : summary.seizures.map(renderSeizure).join('');

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  @page { margin: 16mm 14mm 18mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
         color: #20293A; font-size: 11pt; line-height: 1.5; margin: 0; }
  h1 { font-size: 19pt; margin: 0 0 2pt; letter-spacing: -.3pt; }
  h2 { font-size: 12pt; margin: 18pt 0 6pt; padding-bottom: 3pt;
       border-bottom: 1px solid #E7E0D2; letter-spacing: .3pt; text-transform: uppercase; color: #5B6472; }
  .brand { display: flex; justify-content: space-between; align-items: baseline;
           border-bottom: 2px solid #20293A; padding-bottom: 8pt; margin-bottom: 12pt; }
  .brand .mark { font-size: 13pt; font-weight: 800; }
  .brand .mark span { color: #2F7E86; }
  .sub { color: #5B6472; font-size: 10pt; margin: 0; }
  .stats { display: flex; gap: 22pt; margin: 10pt 0 6pt; }
  .stat .n { font-size: 17pt; font-weight: 700; }
  .stat .l { font-size: 8pt; text-transform: uppercase; letter-spacing: .6pt; color: #5B6472; }
  .caveat { background: #FBF0DD; border-left: 3px solid #DE9F3D; padding: 7pt 9pt;
            font-size: 9.5pt; color: #8A5A17; margin: 8pt 0; }
  .quiet { background: #EAF3EA; border-left: 3px solid #4C8B58; padding: 9pt 11pt;
           color: #2E5A37; font-size: 11pt; margin: 8pt 0; }
  .seizure { border: 1px solid #E7E0D2; border-radius: 6pt; padding: 9pt 11pt;
             margin: 0 0 8pt; page-break-inside: avoid; }
  .seizure header { display: flex; align-items: baseline; gap: 8pt; margin-bottom: 6pt;
                    padding-bottom: 5pt; border-bottom: 1px solid #EFEADF; }
  .idx { background: #2F7E86; color: #fff; width: 15pt; height: 15pt; border-radius: 8pt;
         text-align: center; font-size: 9pt; font-weight: 700; line-height: 15pt; }
  .time { font-weight: 700; font-size: 12pt; }
  .dur { font-weight: 600; color: #215D64; }
  .conf { margin-left: auto; font-size: 8.5pt; color: #5B6472; font-style: italic; }
  .row { display: flex; gap: 8pt; margin: 2pt 0; font-size: 10pt; }
  .k { width: 74pt; flex: none; color: #5B6472; font-size: 9pt; text-transform: uppercase;
       letter-spacing: .3pt; padding-top: 1pt; }
  .v { flex: 1; }
  .none { color: #8A93A1; font-style: italic; }
  .clips { display: flex; flex-wrap: wrap; gap: 8pt; margin-top: 7pt; }
  .clip { display: flex; gap: 7pt; border: 1px solid #EFEADF; border-radius: 5pt; padding: 5pt; width: 100%; }
  .clip img, .clip .noshot { width: 58pt; height: 58pt; object-fit: cover; border-radius: 4pt;
                             background: #EFEADF; flex: none; }
  .clipmeta { display: flex; flex-direction: column; font-size: 9pt; gap: 1pt; }
  .cn { color: #5B6472; }
  .strip { display: flex; gap: 5pt; align-items: flex-end; margin: 8pt 0 4pt; }
  .bar { display: flex; flex-direction: column; align-items: center; gap: 2pt; width: 30pt; }
  .fill { width: 16pt; background: #2F7E86; border-radius: 2pt; }
  .bar .n { font-size: 9pt; font-weight: 700; }
  .bar .d { font-size: 8pt; color: #5B6472; }
  table.doses { width: 100%; border-collapse: collapse; font-size: 9.5pt; }
  table.doses th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .4pt;
                   color: #5B6472; border-bottom: 1px solid #E7E0D2; padding: 4pt 5pt; }
  table.doses td { padding: 4pt 5pt; border-bottom: 1px solid #EFEADF; }
  .s-given { color: #2E5A37; } .s-late { color: #8A5A17; } .s-missed { color: #A93327; }
  footer { margin-top: 16pt; padding-top: 7pt; border-top: 1px solid #E7E0D2;
           font-size: 8.5pt; color: #8A93A1; display: flex; justify-content: space-between; gap: 10pt; }
</style></head>
<body>
  <div class="brand">
    <div class="mark">Paw<span>Track</span></div>
    <div class="sub">${esc(rangeLabel)}</div>
  </div>

  <h1>${esc(dogName)}</h1>
  <p class="sub">${esc(breedLabel)}</p>

  <h2>At a glance</h2>
  <div class="stats">
    <div class="stat"><div class="n">${summary.seizureCount}</div><div class="l">Seizures</div></div>
    <div class="stat"><div class="n">${esc(fmtDuration(d.totalSec))}</div><div class="l">Total time</div></div>
    <div class="stat"><div class="n">${esc(fmtDuration(d.medianSec))}</div><div class="l">Median</div></div>
    <div class="stat"><div class="n">${esc(fmtDuration(d.longestSec))}</div><div class="l">Longest</div></div>
    <div class="stat"><div class="n">${summary.doses.given}/${summary.doses.recorded}</div><div class="l">Doses given</div></div>
  </div>
  ${renderDayStrip(summary)}
  ${caveat}

  <h2>Seizures</h2>
  ${body}

  <h2>Medication</h2>
  ${renderDoses(summary.doseRows)}

  <footer>
    <span>Generated by PawTrack${input.appUrl ? ` · ${esc(input.appUrl)}` : ''} · ${esc(fmtDateTime(summary.generatedAt))}</span>
    <span>Owner-recorded observations. Not a medical device and not veterinary advice.</span>
  </footer>
</body></html>`;
}

/**
 * A filesystem-safe file name.
 *
 * Owners put emoji, slashes and colons in pet names. A slash is a path
 * separator on both platforms, so `Lucy/Bear` would silently write to a
 * directory that does not exist and the export would fail with an error about
 * storage rather than about the name.
 */
export function reportFileName(dogName: string, range: ReportRange, stem: string): string {
  const safe = dogName
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'Dog';
  return `PawTrack-${safe}-${stem}.pdf`;
}
