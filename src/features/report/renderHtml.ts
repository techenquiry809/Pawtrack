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
import type { DailyCheckin, Dog, MedicationWithReminders } from '@/types/domain';

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

/**
 * The clock time, or '' when the record does not carry one.
 *
 * A blank time is stored as the start of that day with the confidence field
 * set to 'unknown'. Printing that through fmtClock puts "00:00" on a vet
 * report, where it is indistinguishable from a seizure genuinely observed at
 * midnight — the one confusion a printed record must not introduce. The entry
 * already carries `timingNote`, so the provenance is stated in words either
 * way; the caller drops the element entirely rather than printing an empty one.
 */
export function fmtClockIfKnown(epochMs: number, confidence: string): string {
  return confidence === 'unknown' ? '' : fmtClock(epochMs);
}

const MONTHS = [
  'Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun',
  'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec',
] as const;

/** `30 Aug 2026` — the date alone, for entries in a multi-day report. */
export function fmtDate(epochMs: number): string {
  const d = new Date(epochMs);
  return `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

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
/* The mark                                                            */
/* ------------------------------------------------------------------ */

/**
 * The PawTrack logo, as inline SVG.
 *
 * ── WHY INLINE SVG AND NOT THE PNG ────────────────────────────────────
 *
 * The launcher icon is a PNG in the bundle. `expo-print` renders a plain HTML
 * string with no base URL, so a `<img src="./assets/icon.png">` resolves
 * against nothing and prints as a broken-image box — the same class of bug as
 * the relative thumbnail paths fixed elsewhere in this feature. Reading the
 * PNG and base64-ing it would work, but it makes this module async, impure and
 * untestable, and it adds ~200KB to every PDF.
 *
 * Vector also prints properly. A 34pt raster mark is 34pt at 72dpi and looks
 * soft on a 600dpi laser; this is resolution-independent and adds ~700 bytes.
 *
 * The drawing is the app's own mark — a paw with a pulse trace through the pad
 * — so an owner and their vet can tell at a glance which app produced the
 * document. That recognition is the whole reason it is here.
 */
export function brandMarkSvg(size = 30): string {
  return `<svg class="logo" width="${size}" height="${size}" viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="PawTrack">
  <circle cx="24" cy="24" r="24" fill="#2F7E86"/>
  <ellipse cx="11.9" cy="19.4" rx="3.5" ry="4.6" fill="#ffffff"/>
  <ellipse cx="19.8" cy="13.4" rx="3.7" ry="4.9" fill="#ffffff"/>
  <ellipse cx="28.2" cy="13.4" rx="3.7" ry="4.9" fill="#ffffff"/>
  <ellipse cx="36.1" cy="19.4" rx="3.5" ry="4.6" fill="#ffffff"/>
  <path d="M24 23c5.4 0 9.6 4 9.6 8.3 0 3.4-2.7 5.4-5.9 5.4-2 0-2.9-.8-3.7-.8s-1.7.8-3.7.8c-3.2 0-5.9-2-5.9-5.4C14.4 27 18.6 23 24 23Z" fill="#ffffff"/>
  <path d="M18.4 31.2h2.6l1.5-3 2.2 5.4 1.6-3.1h3.3" fill="none" stroke="#2F7E86" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>
</svg>`;
}

/* ------------------------------------------------------------------ */
/* Sections                                                            */
/* ------------------------------------------------------------------ */

/**
 * One seizure entry.
 *
 * `showDate` is not cosmetic. Over a single day the time alone identifies an
 * event; over a month or an all-time report it is ambiguous — "10:32" appears
 * dozens of times and a reader cannot tell which day they are looking at
 * without counting back through the list.
 */
function renderSeizure(s: SeizureWithClips, index: number, showDate: boolean): string {
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
            <span>${[fmtClockIfKnown(v.timestamp, v.captureConfidence), fmtDuration(v.durationSec)].filter(Boolean).map((t) => esc(t)).join(' · ')}</span>
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
      ${showDate ? `<span class="day">${esc(fmtDate(s.start))}</span>` : ''}
      ${fmtClockIfKnown(s.start, s.timingConfidence) ? `<span class="time">${esc(fmtClockIfKnown(s.start, s.timingConfidence))}</span>` : ''}
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

/**
 * The activity strip, at whatever granularity the period can actually show.
 *
 * A day report has no strip — one bar is not a trend. Up to 31 days gets one
 * bar per day. Beyond that (an all-time report can be years) the bars are
 * aggregated into MONTHS, because 900 hairline bars on an A4 page is a smear,
 * not a chart, and the reader would have no way to tell a busy month from a
 * rendering artefact.
 */
function renderActivityStrip(summary: ReportSummary): string {
  const days = summary.days;
  if (days.length < 2) return '';

  type Bar = { label: string; count: number };
  let bars: Bar[];
  let caption: string;

  if (days.length <= 31) {
    bars = days.map((d) => ({ label: d.dayKey.slice(8), count: d.seizureCount }));
    caption = 'Seizures per day';
  } else {
    const byMonth = new Map<string, number>();
    for (const d of days) {
      const key = d.dayKey.slice(0, 7);
      byMonth.set(key, (byMonth.get(key) ?? 0) + d.seizureCount);
    }
    bars = [...byMonth.entries()].map(([key, count]) => ({
      // 'Aug', or 'Aug 26' once the range crosses a year boundary and the
      // month alone stops being unique.
      label: MONTHS[Number(key.slice(5, 7)) - 1] ?? key.slice(5, 7),
      count,
    }));
    caption = 'Seizures per month';
  }

  const peak = Math.max(1, ...bars.map((b) => b.count));
  return `
  <p class="stripcap">${esc(caption)}</p>
  <div class="strip">${bars.map((b) => {
    const h = Math.round((b.count / peak) * 34);
    return `<div class="bar">
      <div class="fill" style="height:${b.count > 0 ? Math.max(h, 4) : 1}px"></div>
      <span class="n">${b.count}</span>
      <span class="d">${esc(b.label)}</span>
    </div>`;
  }).join('')}</div>`;
}

/** One `label: value` line, skipped entirely when there is no value. */
function fact(label: string, value: string | null | undefined): string {
  const v = (value ?? '').toString().trim();
  if (!v) return '';
  return `<div class="fact"><span class="fk">${esc(label)}</span><span class="fv">${esc(v)}</span></div>`;
}

/**
 * Who the report is about.
 *
 * Only fields the owner actually filled in are printed. An empty row reading
 * "Weight —" invites a reader to believe the dog was weighed and found to be
 * nothing; an absent row correctly says nothing at all.
 */
function renderDogFacts(dog: Dog, breedLabel: string): string {
  const rows = [
    fact('Breed', breedLabel),
    fact('Sex', dog.sex),
    fact('Age', dog.ageYears !== null ? `${dog.ageYears} years` : ''),
    fact('Weight', dog.weightKg !== null ? `${dog.weightKg} kg` : ''),
    fact('Date of birth', dog.dob),
    fact('Diagnosis', dog.diagnosisStatus),
    fact('First seizure', dog.firstSeizureDate),
    fact('Seizure type', dog.seizureType),
    fact('Allergies', dog.allergies),
    fact('Diet', dog.diet),
  ].filter(Boolean).join('');
  return rows ? `<div class="facts">${rows}</div>` : '';
}

/**
 * The prescribed regimen — what the dog is ON, not what was given.
 *
 * Printed even when the dose log below is empty. "Three drugs prescribed, no
 * doses recorded this week" is a different and more useful statement than an
 * empty medication section, and only this table can make it.
 */
function renderRegimen(meds: MedicationWithReminders[]): string {
  if (meds.length === 0) {
    return '<p class="none">No medication has been added for this dog.</p>';
  }
  return `
  <table class="grid">
    <thead><tr><th>Medication</th><th>Dose</th><th>Frequency</th><th>Reminders</th><th>Prescriber</th></tr></thead>
    <tbody>${meds.map((m) => {
      const dose = [m.dose, m.unit].filter((x) => x && x.trim()).join(' ');
      const times = m.reminders.filter((r) => r.enabled).map((r) => r.timeHHMM);
      return `
      <tr>
        <td class="strong">${esc(m.name)}</td>
        <td>${esc(dose || '—')}</td>
        <td>${esc(m.frequency || '—')}</td>
        <td>${times.length > 0 ? esc(times.join(', ')) : '<span class="none">none set</span>'}</td>
        <td>${esc(m.prescriber || '—')}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>`;
}

const ENERGY_WORDS = ['Flat', 'Low', 'Steady', 'Good', 'Bouncy'] as const;

/**
 * The daily check-in log.
 *
 * ── THE `moodOnly` RULE ───────────────────────────────────────────────
 *
 * A row created by tapping a face on the dashboard has a REAL energy value and
 * schema defaults for everything else — appetite 'normal', water 'normal',
 * stress 2, GI 'none'. Those defaults were never answered by anybody.
 *
 * Printing them would manufacture clinical observations out of a single tap,
 * which is the exact failure `mood_only` was added to prevent (see the note at
 * the top of the Home screen). So a mood-only row prints its energy and dashes
 * the rest, and the column note says why.
 */
function renderCheckins(rows: DailyCheckin[]): string {
  if (rows.length === 0) {
    return '<p class="none">No daily check-ins were recorded in this period.</p>';
  }
  const partial = rows.some((c) => c.moodOnly);
  return `
  <table class="grid">
    <thead><tr>
      <th>Day</th><th>Energy</th><th>Appetite</th><th>Water</th>
      <th>Stress</th><th>Gut</th><th>Meds on time</th><th>Sleep</th><th>Noted</th>
    </tr></thead>
    <tbody>${rows.map((c) => {
      const dash = '<span class="none">—</span>';
      const energy = `${ENERGY_WORDS[c.energy - 1] ?? c.energy}`;
      if (c.moodOnly) {
        return `<tr>
          <td>${esc(c.checkInDate)}</td><td>${esc(energy)}</td>
          <td>${dash}</td><td>${dash}</td><td>${dash}</td><td>${dash}</td><td>${dash}</td><td>${dash}</td>
          <td class="none">energy only</td>
        </tr>`;
      }
      return `<tr>
        <td>${esc(c.checkInDate)}</td>
        <td>${esc(energy)}</td>
        <td>${esc(c.appetite)}</td>
        <td>${esc(c.water)}</td>
        <td>${c.stress}/5</td>
        <td>${esc(c.gi)}</td>
        <td>${c.medOnTime ? 'yes' : 'no'}</td>
        <td>${c.sleepHrs !== null ? `${esc(String(c.sleepHrs))} h` : dash}</td>
        <td>${c.unusual ? esc(c.unusual) : dash}</td>
      </tr>`;
    }).join('')}</tbody>
  </table>
  ${partial ? `<p class="foot">Rows marked <em>energy only</em> were logged with a single tap on the
    dashboard. Only the energy value was entered; the other fields were never answered and are
    left blank rather than filled with defaults.</p>` : ''}`;
}

/** The people to call. Printed only when the owner has filled something in. */
function renderCareTeam(dog: Dog): string {
  const block = (title: string, v: { name: string; clinic: string; phone: string }) => {
    const rows = [fact('Name', v.name), fact('Clinic', v.clinic), fact('Phone', v.phone)]
      .filter(Boolean).join('');
    return rows ? `<div class="team"><h3>${esc(title)}</h3><div class="facts">${rows}</div></div>` : '';
  };
  const out = [block('Veterinarian', dog.vet), block('Emergency', dog.emergencyVet)]
    .filter(Boolean).join('');
  return out ? `<div class="teams">${out}</div>` : '';
}

/* ------------------------------------------------------------------ */
/* The document                                                        */
/* ------------------------------------------------------------------ */

export type RenderInput = {
  summary: ReportSummary;
  /**
   * The full profile, so the document can state who it is about.
   *
   * The name alone was not enough: a vet holding two printouts from two
   * clients both called Bella needs the breed, the age and the diagnosis on
   * the page to tell them apart and to read the rest in context.
   */
  dog: Dog;
  dogName: string;
  breedLabel: string;
  rangeLabel: string;
  /** Shown in the footer so a reader can find the app. */
  appUrl?: string;
};

export function renderReportHtml(input: RenderInput): string {
  const { summary, dog, dogName, breedLabel, rangeLabel } = input;
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
    // Explicit arrow, NOT `map(renderSeizure)`: map passes a third argument
    // (the array), which would arrive as `showDate` and be truthy always.
    : summary.seizures.map((s, i) => renderSeizure(s, i, summary.days.length > 1)).join('');

  const dayCount = summary.days.length;
  const perDay = dayCount > 0
    ? (summary.seizureCount / dayCount).toFixed(dayCount > 31 ? 2 : 1)
    : '0';

  return `<!doctype html>
<html><head><meta charset="utf-8" />
<style>
  @page { margin: 15mm 13mm 16mm; }
  * { box-sizing: border-box; }
  body { font-family: -apple-system, "Helvetica Neue", Helvetica, Arial, sans-serif;
         color: #20293A; font-size: 11pt; line-height: 1.5; margin: 0; }
  h1 { font-size: 19pt; margin: 0 0 2pt; letter-spacing: -.3pt; }
  h2 { font-size: 12pt; margin: 17pt 0 6pt; padding-bottom: 3pt;
       border-bottom: 1px solid #E7E0D2; letter-spacing: .3pt; text-transform: uppercase; color: #5B6472;
       page-break-after: avoid; }
  h3 { font-size: 9.5pt; margin: 0 0 3pt; text-transform: uppercase; letter-spacing: .4pt; color: #5B6472; }
  .brand { display: flex; align-items: center; gap: 9pt;
           border-bottom: 2px solid #20293A; padding-bottom: 8pt; margin-bottom: 12pt; }
  .brand .logo { flex: none; }
  .brand .mark { font-size: 14pt; font-weight: 800; letter-spacing: -.2pt; }
  .brand .mark span { color: #2F7E86; }
  .brand .tag { font-size: 8pt; color: #5B6472; letter-spacing: .3pt; text-transform: uppercase; }
  .brand .period { margin-left: auto; text-align: right; font-size: 10pt; color: #20293A; font-weight: 600; }
  .sub { color: #5B6472; font-size: 10pt; margin: 0; }
  .facts { display: flex; flex-wrap: wrap; gap: 3pt 16pt; margin: 7pt 0 0; }
  .fact { display: flex; gap: 5pt; font-size: 9.5pt; }
  .fk { color: #5B6472; text-transform: uppercase; font-size: 8pt; letter-spacing: .3pt; padding-top: 1.5pt; }
  .fv { font-weight: 600; }
  .teams { display: flex; gap: 22pt; }
  .team { flex: 1; }
  .stats { display: flex; flex-wrap: wrap; gap: 16pt; margin: 10pt 0 6pt; }
  .stat .n { font-size: 16pt; font-weight: 700; }
  .stat .l { font-size: 7.5pt; text-transform: uppercase; letter-spacing: .5pt; color: #5B6472; }
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
  .day { font-weight: 700; font-size: 11pt; }
  .dur { font-weight: 600; color: #215D64; }
  .conf { margin-left: auto; font-size: 8.5pt; color: #5B6472; font-style: italic; }
  .row { display: flex; gap: 8pt; margin: 2pt 0; font-size: 10pt; }
  .k { width: 84pt; flex: none; color: #5B6472; font-size: 9pt; text-transform: uppercase;
       letter-spacing: .3pt; padding-top: 1pt; }
  .v { flex: 1; }
  .none { color: #8A93A1; font-style: italic; }
  .strong { font-weight: 700; }
  .clips { display: flex; flex-wrap: wrap; gap: 8pt; margin-top: 7pt; }
  .clip { display: flex; gap: 7pt; border: 1px solid #EFEADF; border-radius: 5pt; padding: 5pt; width: 100%; }
  .clip img, .clip .noshot { width: 58pt; height: 58pt; object-fit: cover; border-radius: 4pt;
                             background: #EFEADF; flex: none; }
  .clipmeta { display: flex; flex-direction: column; font-size: 9pt; gap: 1pt; }
  .cn { color: #5B6472; }
  .stripcap { font-size: 8pt; text-transform: uppercase; letter-spacing: .5pt; color: #5B6472; margin: 10pt 0 0; }
  .strip { display: flex; gap: 3pt; align-items: flex-end; margin: 5pt 0 4pt; }
  .bar { display: flex; flex-direction: column; align-items: center; gap: 2pt; flex: 1; min-width: 0; }
  .fill { width: 70%; max-width: 16pt; background: #2F7E86; border-radius: 2pt; }
  .bar .n { font-size: 8pt; font-weight: 700; }
  .bar .d { font-size: 7pt; color: #5B6472; }
  table.grid, table.doses { width: 100%; border-collapse: collapse; font-size: 9pt; }
  table.grid th, table.doses th { text-align: left; font-size: 7.5pt; text-transform: uppercase;
                   letter-spacing: .4pt; color: #5B6472; border-bottom: 1px solid #E7E0D2; padding: 4pt 5pt; }
  table.grid td, table.doses td { padding: 4pt 5pt; border-bottom: 1px solid #EFEADF; vertical-align: top; }
  table.grid tr, table.doses tr { page-break-inside: avoid; }
  .s-given { color: #2E5A37; } .s-late { color: #8A5A17; } .s-missed { color: #A93327; }
  .foot { font-size: 8.5pt; color: #5B6472; margin: 5pt 0 0; }
  footer { margin-top: 16pt; padding-top: 7pt; border-top: 1px solid #E7E0D2;
           font-size: 8.5pt; color: #8A93A1; display: flex; justify-content: space-between; gap: 10pt; }
</style></head>
<body>
  <div class="brand">
    ${brandMarkSvg(30)}
    <div>
      <div class="mark">Paw<span>Track</span></div>
      <div class="tag">Seizure &amp; care record</div>
    </div>
    <div class="period">${esc(rangeLabel)}</div>
  </div>

  <h1>${esc(dogName)}</h1>
  <p class="sub">${esc(breedLabel)}</p>
  ${renderDogFacts(dog, breedLabel)}

  <h2>At a glance</h2>
  <div class="stats">
    <div class="stat"><div class="n">${summary.seizureCount}</div><div class="l">Seizures</div></div>
    <div class="stat"><div class="n">${esc(perDay)}</div><div class="l">Per day</div></div>
    <div class="stat"><div class="n">${esc(fmtDuration(d.totalSec))}</div><div class="l">Total time</div></div>
    <div class="stat"><div class="n">${esc(fmtDuration(d.medianSec))}</div><div class="l">Median</div></div>
    <div class="stat"><div class="n">${esc(fmtDuration(d.longestSec))}</div><div class="l">Longest</div></div>
    <div class="stat"><div class="n">${summary.doses.given}/${summary.doses.recorded}</div><div class="l">Doses given</div></div>
    <div class="stat"><div class="n">${summary.checkins.length}</div><div class="l">Check-ins</div></div>
    <div class="stat"><div class="n">${summary.videoCount}</div><div class="l">Videos</div></div>
  </div>
  ${renderActivityStrip(summary)}
  ${caveat}

  <h2>Seizures</h2>
  ${body}

  <h2>Medication prescribed</h2>
  ${renderRegimen(summary.medications)}

  <h2>Doses recorded</h2>
  ${renderDoses(summary.doseRows)}

  <h2>Daily check-ins</h2>
  ${renderCheckins(summary.checkins)}

  ${renderCareTeam(dog) ? `<h2>Care team</h2>${renderCareTeam(dog)}` : ''}

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
export function reportFileName(dogName: string, stem: string): string {
  const safe = dogName
    .replace(/[^\p{L}\p{N}]+/gu, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40) || 'Dog';
  return `PawTrack-${safe}-${stem}.pdf`;
}
