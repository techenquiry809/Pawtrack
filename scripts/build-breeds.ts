/**
 * Regenerates the BREED_LIST literals in src/constants/breeds.ts from a
 * vendored registry CSV.
 *
 * Run manually, review the diff, commit the output. This is deliberately NOT a
 * postinstall hook: the breed list changes a few times a year, and a build step
 * that silently regenerates a 200-plus-entry constant is a build step that will
 * one day silently change stored health data.
 *
 *   npx tsx scripts/build-breeds.ts data/akc-breeds.csv
 *
 * ── WHICH REGISTRY ────────────────────────────────────────────────────
 * Target AKC, not FCI. The current list is AKC-shaped — Belgian Shepherd is
 * split into Malinois / Sheepdog / Tervuren and Poodle into Standard /
 * Miniature / Toy, neither of which the FCI does. Regenerating from FCI
 * nomenclature would merge those entries and orphan every stored breed_id
 * that points at one of them.
 *
 *   AKC (~277):  https://github.com/tmfilho/akcdata
 *   FCI (~350):  https://github.com/paiv/fci-breeds   <- shape mismatch, see above
 *
 * ── BEFORE YOU VENDOR ANYTHING ────────────────────────────────────────
 * Check the source repository's licence. Breed names are facts and not
 * copyrightable, but a compiled database can carry sui generis database rights
 * in the EU, and PawTrack is a commercial product. Record the source, the
 * licence and the date pulled in data/README.md so the next person does not
 * have to re-litigate it.
 *
 * ── MIGRATION SAFETY ──────────────────────────────────────────────────
 * A breed_id already written to a dog row is a foreign key in all but name.
 * This script REPORTS slugs that would disappear; it does not remove them for
 * you. Removing one needs a data migration that remaps affected dogs, not a
 * silent delete.
 */

import { readFileSync, existsSync } from 'node:fs';

/** Registry CSVs give ALL-CAPS names; particles stay lowercase unless leading. */
const PARTICLES = new Set([
  'de', 'del', 'du', 'da', 'di', 'of', 'the', 'von', 'van', 'la', 'le', 'and',
]);

function titleCase(raw: string): string {
  return raw
    .toLowerCase()
    .split(/\s+/)
    .map((word, index) =>
      index > 0 && PARTICLES.has(word)
        ? word
        : word.charAt(0).toUpperCase() + word.slice(1),
    )
    .join(' ');
}

export function slugify(name: string): string {
  return name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** Minimal CSV reader: handles quoted fields and escaped double quotes. */
function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i += 1) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i += 1;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === ',' && !inQuotes) {
      fields.push(current);
      current = '';
    } else {
      current += char;
    }
  }
  fields.push(current);
  return fields;
}

/** Slugs currently shipping, so we can report removals rather than cause them. */
function existingSlugs(): Set<string> {
  const path = 'src/constants/breeds.ts';
  if (!existsSync(path)) return new Set();
  const source = readFileSync(path, 'utf8');
  return new Set(
    [...source.matchAll(/breedId: "([^"]+)"/g)].map((m) => m[1] as string),
  );
}

function main(): void {
  const csvPath = process.argv[2];
  if (!csvPath) {
    console.error('Usage: npx tsx scripts/build-breeds.ts <path-to-csv>');
    process.exit(1);
  }

  const lines = readFileSync(csvPath, 'utf8').split(/\r?\n/).filter(Boolean);
  const seen = new Set<string>();

  const breeds = lines
    .slice(1) // header
    .map((line) => {
      const fields = parseCsvLine(line);
      const rawName = fields[0];
      if (!rawName) return null;
      return { breedId: slugify(rawName), breedName: titleCase(rawName) };
    })
    .filter((b): b is { breedId: string; breedName: string } => b !== null)
    // A duplicate slug means two registry rows collapsed to one name. Report
    // it — silently dropping a breed is how the list drifts from the registry.
    .filter((b) => {
      if (seen.has(b.breedId)) {
        console.warn(`  duplicate slug dropped: ${b.breedId}`);
        return false;
      }
      seen.add(b.breedId);
      return true;
    })
    .sort((a, b) => a.breedName.localeCompare(b.breedName));

  const previous = existingSlugs();
  const removed = [...previous].filter((id) => !seen.has(id));
  const added = [...seen].filter((id) => !previous.has(id));

  console.log(`\n${breeds.length} breeds parsed.`);
  console.log(`  new:     ${added.length}`);
  console.log(`  removed: ${removed.length}`);

  if (removed.length > 0) {
    console.warn(
      '\n!! These slugs disappear. Any dog row already storing one would be\n' +
        '!! orphaned. Write a migration that remaps them BEFORE shipping this:\n' +
        removed.map((id) => `     ${id}`).join('\n'),
    );
  }

  // Printed rather than written: the surrounding module carries hand-curated
  // aliases, quick picks and epilepsy metadata that must not be clobbered.
  // Paste the block between the BREED_LIST brackets and review the diff.
  console.log('\n--- paste between the BREED_LIST brackets ---\n');
  console.log(
    breeds
      .map(
        (b) =>
          `  { breedId: ${JSON.stringify(b.breedId)}, breedName: ${JSON.stringify(b.breedName)} },`,
      )
      .join('\n'),
  );
}

main();
