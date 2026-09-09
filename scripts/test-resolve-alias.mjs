/**
 * Teaches `node --test` the `@/` alias, so unit tests can cover any module.
 *
 * ── WHY THIS EXISTS ───────────────────────────────────────────────────
 *
 * `npm test` runs the TypeScript sources directly under Node's type stripping.
 * Stripping erases `import type`, so a module importing only TYPES across the
 * alias loads fine — which is why src/features/report/renderHtml.ts and
 * src/features/analytics/clusters.ts are testable despite using `@/`.
 *
 * A module with a VALUE import across it is not: Node has no idea what `@/`
 * means, and fails with `Cannot find package '@/utils'`. tsconfig `paths` do
 * not help — they configure the type checker and Metro, neither of which is in
 * the loop here.
 *
 * The effect was a silent rule nobody wrote down: a file could only be unit
 * tested if it happened to avoid importing a value through the alias. Every
 * tested module satisfied it by coincidence. src/features/timeline is the first
 * one that needed a test AND needed a helper (`hasKnownTime`) — and the two
 * ways out without this file are both worse than it:
 *
 *   - rewrite that module's imports as `../../utils/time`, leaving one file
 *     stylistically out of step with the rest of src for a reason invisible at
 *     the import line, which the next reader tidies away and breaks the test
 *   - do not test it, which is how the check-in rendering bugs shipped
 *
 * ── HOW ───────────────────────────────────────────────────────────────
 *
 * `module.registerHooks` is Node's synchronous, in-thread resolver hook. It is
 * the right tool over an async `--loader`: the resolution here is a string
 * rewrite with no I/O, and the sync form has no worker thread to keep in step.
 *
 * Registered from `--import` in the `test` script, so it applies to the whole
 * run and NOTHING in the app ever imports it. Metro resolves the alias itself
 * from tsconfig; this file is test-time only.
 */

import { registerHooks } from 'node:module';
import { pathToFileURL } from 'node:url';
import path from 'node:path';

/** Mirrors the single `paths` entry in tsconfig.json — `@/*` → `src/*`. */
const ALIAS = '@/';
const SRC = pathToFileURL(path.join(import.meta.dirname, '..', 'src', '/')).href;

/**
 * What to try when a specifier names no file extension.
 *
 * Node's ESM resolver requires one; TypeScript's does not, and the codebase is
 * written in the TypeScript style (`from './confidence'`). The empty string is
 * first so a specifier that DID carry its own extension resolves untouched.
 *
 * Both a sibling module and a directory's index are covered, because both
 * appear in src — `./daily.ts` next to `@/features/timeline`.
 */
const EXTENSIONS = ['', '.ts', '.tsx', '/index.ts', '/index.tsx'];

registerHooks({
  resolve(specifier, context, nextResolve) {
    /*
     * Handed to `nextResolve` rather than returned directly so that every later
     * hook, and Node's own resolution, still runs on the rewritten specifier.
     * Returning a url here would short-circuit them.
     */
    const rewritten = specifier.startsWith(ALIAS)
      ? new URL(specifier.slice(ALIAS.length), SRC).href
      : specifier;

    /*
     * Bare package names ('node:test', 'zod') are left entirely alone: they
     * resolve through node_modules, where appending '.ts' is meaningless and
     * an `exports` map is the thing that decides.
     */
    const isPath =
      rewritten.startsWith('.') || rewritten.startsWith('/') || rewritten.startsWith('file:');
    if (!isPath) return nextResolve(rewritten, context);

    let firstError;
    for (const ext of EXTENSIONS) {
      try {
        return nextResolve(rewritten + ext, context);
      } catch (e) {
        // The FIRST failure is the one worth reporting: it names the specifier
        // as written. The later ones are this loop's guesses, and surfacing
        // "cannot find ./x/index.tsx" for an import of './x' would send a
        // reader looking for a file nobody mentioned.
        firstError ??= e;
      }
    }
    throw firstError;
  },
});
