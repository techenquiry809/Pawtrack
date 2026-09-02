# The vet report

The PDF an owner hands to a veterinarian. This document explains **what goes
in it, why each rule exists, and what you must not break** when you extend it.

Read [ARCHITECTURE.md](./ARCHITECTURE.md) first — the "one rule that outranks
everything" applies here more than anywhere else in the app. This file is the
only artefact a clinician reads, and it leaves the app entirely: nobody can ask
it a follow-up question.

---

## The rule this whole feature is built around

> **A clinician cannot tell a confident wrong number from a right one.**

Every design decision below follows from that. On screen an owner can tap
something to find out more; on paper a number is simply believed. So the
report never prints a value the app cannot stand behind, and never prints a
placeholder that could be mistaken for a measurement.

Three concrete forms this takes:

| Situation | What the report does | Where |
|---|---|---|
| A duration the app does not trust | Excluded from the figures, **listed anyway**, and the exclusion is stated with its denominator | `summarize.ts`, the caveat in `renderHtml.ts` |
| A seizure with no clock time given | Prints the date only — never `00:00` | `fmtClockIfKnown` |
| A check-in logged by one tap on the dashboard | Prints the energy, **dashes every other column**, and says why | `renderCheckins` |

That last one is the easiest to get wrong. A `mood_only` row holds schema
defaults — `appetite: 'normal'`, `stress: 2` — that **nobody answered**.
Printing them would manufacture clinical observations out of a single tap.

---

## The four scopes

| Scope | Span | File stem |
|---|---|---|
| `day` | One calendar day | `2026-08-30` |
| `week` | The ISO week (Mon–Sun) containing the chosen day | `2026-08-24-to-30` |
| `month` | The calendar month containing the chosen day | `2026-08` |
| `all` | First record ever → the chosen day | `all-to-2026-09-01` |

Week and month are **anchored**: picking any day inside them produces the same
report. That is what makes the picker forgiving — an owner who taps Thursday
meaning "this week" gets the week.

### Why `all` is resolved in two passes

`range.ts` is pure and imports nothing at runtime, so `node --test` can load
it. It therefore cannot know when a dog's records start. An all-time report is
resolved in two steps:

```ts
const earliest = await earliestRecordDay(dog.id, dayKeyOf); // collect.ts
const range = resolveRange('all', dayKey, earliest ?? undefined);
```

`earliestRecordDay` checks **seizures, check-ins and doses** — not just
seizures. An owner can log check-ins for weeks before the first seizure, and
can log doses for a dog that has never had one recorded. Anchoring on seizures
alone would silently clip that history off the front of the one scope whose
entire promise is that nothing was left out.

With no records at all it returns `null`, which collapses the range to the
chosen day: an empty report about today, not an empty report about 1970.

### The half-open rule

Every range is `[fromMs, toMs)`. Consecutive periods share no instant, so a
seizure at exactly `00:00:00.000` belongs to the period beginning and to
nothing else. A closed range would put it in both, and an owner comparing
August to September would count one seizure twice.

`range.test.ts` pins this for months explicitly.

---

## What the document contains

In order:

1. **Brand header** — logo, `PawTrack`, "Seizure & care record", and the period.
2. **Dog** — name, breed, then only the profile fields the owner actually
   filled in. An empty `Weight —` row invites a reader to believe the dog was
   weighed and found to be nothing.
3. **At a glance** — seizures, per-day rate, total / median / longest duration,
   doses given over doses recorded, check-ins, videos.
4. **Activity strip** — one bar per day up to 31 days, per **month** beyond
   that. 900 hairline bars on A4 is a smear, not a chart.
5. **Caveat** — the denominator sentence, when anything was excluded.
6. **Seizures** — every record in full: before / during / awareness / after,
   recovery, owner severity, notes, and each clip's poster frame and phase
   notes. The date is printed on each entry whenever the report spans more
   than one day, because `10:32` alone is ambiguous over a month.
7. **Medication prescribed** — the regimen: name, dose, frequency, reminder
   times, prescriber.
8. **Doses recorded** — the dose log, colour-coded given / late / missed.
9. **Daily check-ins** — the full table, with the `mood_only` rule above.
10. **Care team** — vet and emergency vet, omitted entirely when empty.
11. **Footer** — app, URL, generation time, and the not-a-medical-device line.

### Why the regimen and the dose log are separate sections

They answer different questions and a vet reads both. The regimen is what the
dog is **prescribed**; the log is what was actually **given**. A report showing
only the log leaves a reader unable to tell a missed dose from a drug that was
never scheduled that day. "Three drugs prescribed, no doses recorded this week"
is a finding, and only the two sections together can state it.

The regimen is deliberately **not** filtered to the range — it is the current
list — and it is deliberately **not** part of `isEmpty`. A dog on three drugs
with nothing logged this week has an empty *period*, and saying otherwise
because a medication exists on file would hide exactly that finding.

---

## The logo is inline SVG, and must stay that way

`expo-print` renders a plain HTML string with **no base URL**. Any
`<img src="./assets/icon.png">` resolves against nothing and prints as a
broken-image box — the same class of bug as the relative thumbnail paths that
once made every video still in the report blank.

Options considered:

| Approach | Why not |
|---|---|
| `<img src="./assets/icon.png">` | No base URL. Prints broken. |
| Base64 the PNG | Makes `renderHtml` async, impure and untestable; adds ~200 KB to every PDF; still soft at 600 dpi. |
| **Inline SVG** ✅ | Pure, ~700 bytes, resolution-independent. |

`brandMarkSvg()` draws the app's own mark — a paw with a pulse trace through
the pad — so an owner and their vet can tell at a glance which app produced the
document. That recognition is the reason it is there.

---

## Escaping is the security model

`renderHtml.ts` builds one big string. Owner-controlled text reaching it
includes the dog's name, breed description, seizure notes, **medication names,
doses, frequencies and prescribers**, clinic names, and per-clip video notes.

The rule is mechanical, not a matter of judgement:

> Interpolation into the template is only ever `${esc(...)}` or a number this
> module computed itself.

`renderHtml.test.ts` feeds hostile strings through the real renderer and
asserts no tag can form. If you add a field, add it to a test.

---

## Purity, and why it matters here

| Module | Imports | Testable under `node --test` |
|---|---|---|
| `range.ts` | none | ✅ |
| `summarize.ts` | types only | ✅ |
| `renderHtml.ts` | types only | ✅ |
| `collect.ts` | repos, file store | ❌ (it is the I/O layer) |
| `reportExport.ts` | expo-print, expo-sharing | ❌ |

The split is deliberate: the parts of this feature that can be wrong in ways a
vet would not notice are exactly the parts under test. Adding a runtime `@/`
import to any of the top three makes the whole module untestable — `node --test`
strips types but does not resolve the `@/` alias.

`toAbsoluteUri` is called in `collect.ts`, not `renderHtml.ts`, for this
reason: poster frames are stored relative and must be absolute in the PDF, but
resolving them is I/O, so it happens before the pure layer sees them.

---

## Extending it

- **A new statistic** → `summarize.ts`, with its denominator. If it is computed
  from a subset, say which subset in the caveat.
- **A new section** → a `render*` function in `renderHtml.ts`, `esc()` on every
  owner string, and a test.
- **A new scope** → `ReportScope` in `range.ts`, a branch in `resolveRange`,
  `formatRangeLabel` and `rangeFileStem`, plus boundary tests. Check the
  activity strip still reads at that length.
- **Never** add a field to the PDF that the app cannot vouch for. If the value
  might be a default nobody entered, either omit it or mark it, the way
  `mood_only` is marked.
