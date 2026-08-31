/**
 * Live check against the real Supabase project.
 *
 *   node scripts/verify-supabase.mjs
 *
 * Uses ONLY the public anon key — the same credential the app ships with. That
 * is deliberate: it verifies what a device actually experiences, and it means
 * this script can never do anything a stranger with the app bundle could not
 * already do. It creates nothing and deletes nothing.
 *
 * ── WHAT THE RESPONSES MEAN ───────────────────────────────────────────────
 *
 * Probing a table as `anon` distinguishes three states that are easy to
 * confuse, and only one of them is correct:
 *
 *   404 / PGRST205   the table is not there — migrations have not been applied
 *   401 / 42501      permission denied — migrations AND the grants hardening
 *                    are applied. THIS IS THE PASS.
 *   200 with []      the table exists and anon can still reach it. RLS is
 *                    returning nothing, so no data leaks, but the anon revoke
 *                    from 20260828000700 has not been applied — one forgotten
 *                    policy away from being readable.
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

/* ------------------------------------------------------------------ */

function loadEnv() {
  let raw = '';
  try {
    raw = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  } catch {
    return {};
  }
  const env = {};
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i < 0) continue;
    env[trimmed.slice(0, i).trim()] = trimmed
      .slice(i + 1)
      .trim()
      .replace(/^["']|["']$/g, '');
  }
  return env;
}

const env = loadEnv();
const URL_ = env.EXPO_PUBLIC_SUPABASE_URL || env.SUPABASE_URL || '';
// Same fallback list as app.config.ts — see the note there on why.
const KEY =
  env.EXPO_PUBLIC_SUPABASE_ANON_KEY ||
  env.EXPO_PUBLIC_SUPABASE_PUBLISHABLE_KEY ||
  env.EXPO_PUBLIC_SUPABASE_KEY ||
  env.SUPABASE_ANON_KEY ||
  env.SUPABASE_PUBLISHABLE_KEY ||
  env.SUPABASE_KEY ||
  '';

const SYNCED = [
  'dogs', 'seizures', 'videos', 'seizure_edits', 'medications',
  'medication_reminders', 'medication_doses', 'daily_checkins', 'meals',
  'user_settings', 'user_devices', 'sync_meta',
];

let failures = 0;
const ok = (m) => console.log(`  \x1b[32m✓\x1b[0m ${m}`);
const bad = (m) => { failures += 1; console.log(`  \x1b[31m✗\x1b[0m ${m}`); };
const info = (m) => console.log(`    ${m}`);

/* ------------------------------------------------------------------ */

if (!URL_ || !KEY) {
  console.log('\nCannot run: Supabase config is incomplete.\n');
  console.log(`  EXPO_PUBLIC_SUPABASE_URL       ${URL_ ? 'set' : 'MISSING'}`);
  console.log(`  EXPO_PUBLIC_SUPABASE_ANON_KEY  ${KEY ? 'set' : 'MISSING'}`);
  console.log('  (also accepted: …_PUBLISHABLE_KEY, …_SUPABASE_KEY)');
  console.log('\nBoth live in .env (gitignored). Get them from');
  console.log('Supabase → Project Settings → API.\n');
  process.exit(1);
}

console.log(`\nProject: ${URL_.replace(/https:\/\/(.{6}).*/, 'https://$1…')}\n`);

/* ---- 1. The key is accepted --------------------------------------
 *
 * Checked against /auth/v1/settings, NOT /rest/v1/.
 *
 * The PostgREST root endpoint now answers "Secret API key required" to a
 * publishable key by design — it serves the OpenAPI spec, which is considered
 * privileged. Treating that 401 as a bad key is a false negative that makes a
 * perfectly good key look rotated, which is exactly what it did on the first
 * run of this script.
 */
console.log('Credentials');
{
  const looksSecret = KEY.startsWith('sb_secret_') || KEY.includes('service_role');
  if (looksSecret) {
    bad('this is a SECRET key — it must never be in a client bundle');
    info('use the publishable / anon key; the secret key bypasses RLS entirely');
  }

  const res = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } });
  if (res.ok) {
    ok(`key accepted by the project (${KEY.startsWith('sb_') ? 'publishable' : 'legacy anon'})`);
  } else {
    bad(`key rejected (HTTP ${res.status})`);
    info('it does not belong to this project, or it has been rotated');
  }
}

/* ---- 2. Which auth providers are actually enabled ----------------- */
console.log('\nAuth providers');
{
  const res = await fetch(`${URL_}/auth/v1/settings`, { headers: { apikey: KEY } });
  if (!res.ok) {
    bad(`could not read auth settings (HTTP ${res.status})`);
  } else {
    const s = await res.json();
    const ext = s.external ?? {};
    const want = { apple: 'Apple', google: 'Google', email: 'Email' };
    for (const [key, label] of Object.entries(want)) {
      const on = key === 'email' ? ext.email !== false : ext[key] === true;
      if (on) ok(`${label} enabled`);
      else {
        bad(`${label} NOT enabled in the project`);
        info(`Authentication → Providers → ${label}`);
      }
    }
    // Magic link needs signups permitted, or a first-time user's link 500s.
    if (s.disable_signup) {
      bad('signups are disabled — magic-link sign-in will fail for new users');
    } else {
      ok('signups permitted');
    }
  }
}

/* ---- 3. Is the schema there, and is anon locked out? -------------- */
let schemaPresent = false;
console.log('\nSchema and anon exposure');
{
  const supabase = createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  let missing = 0, exposed = 0, locked = 0;

  for (const table of SYNCED) {
    const { error } = await supabase.from(table).select('*').limit(1);

    if (!error) {
      // Readable by anon. RLS still returns nothing, but the table should not
      // be reachable at all after the grants hardening.
      exposed += 1;
      continue;
    }
    const code = error.code ?? '';
    const msg = (error.message ?? '').toLowerCase();

    if (code === 'PGRST205' || code === '42P01' || msg.includes('does not exist')) {
      missing += 1;
    } else if (code === '42501' || msg.includes('permission denied')) {
      locked += 1;
    } else {
      bad(`${table}: unexpected ${code || '?'} — ${error.message}`);
    }
  }

  if (missing === SYNCED.length) {
    bad(`PostgREST cannot see any of the ${SYNCED.length} tables (PGRST205)`);
    info('This has TWO causes and they need different fixes:');
    info('  1. the SQL was never applied, or errored partway through');
    info("  2. it WAS applied and PostgREST's schema cache is stale");
    info("Run this in the SQL Editor to tell them apart:");
    info("  select count(*) from pg_tables where schemaname = 'public';");
    info("  notify pgrst, 'reload schema';");
  } else if (missing > 0) {
    bad(`${missing} of ${SYNCED.length} tables missing — migrations partially applied`);
  } else {
    ok(`all ${SYNCED.length} tables present`);
    schemaPresent = true;
  }

  if (missing === 0) {
    if (locked === SYNCED.length) {
      ok('anon is locked out of every table (grants hardening applied)');
    } else if (exposed > 0) {
      bad(`${exposed} table(s) still reachable by anon`);
      info('apply 20260828000700_grants_hardening.sql');
    }
  }
}

/* ---- 4. sync_push exists and refuses an anonymous caller ---------- */
console.log('\nsync_push RPC');
{
  const supabase = createClient(URL_, KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await supabase.rpc('sync_push', { payload: { tables: {} } });

  if (!error) {
    bad('an UNAUTHENTICATED push was accepted — this should never happen');
  } else if ((error.message ?? '').toLowerCase().includes('not authenticated')) {
    ok('exists, and refuses an unauthenticated caller');
  } else if (error.code === 'PGRST202') {
    bad('not visible to PostgREST (PGRST202) — same two causes as above');
  } else if (error.code === '42501') {
    ok('exists, and anon has no EXECUTE (also fine)');
  } else {
    bad(`unexpected ${error.code ?? '?'} — ${error.message}`);
  }
}

/* ---- 5. purge_tombstones must NOT be callable by anon -------------
 *
 * Only meaningful once the schema is actually there. A function that does not
 * exist is trivially not callable, and reporting that as a security pass is a
 * green tick that means nothing — worse than no check, because it reads as
 * reassurance.
 */
console.log('\nPrivilege regression check');
{
  if (!schemaPresent) {
    info('skipped — needs the schema applied first');
  } else {
    const supabase = createClient(URL_, KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { error } = await supabase.rpc('purge_tombstones');

    if (!error) {
      bad('anon CAN run purge_tombstones() — apply the grants hardening');
      info('a stranger with the public key can force every device to resync');
    } else if (error.code === '42501') {
      ok('purge_tombstones() is not reachable by anon');
    } else if (error.code === 'PGRST202') {
      bad('purge_tombstones() is not visible — 20260828000400 not applied');
    } else {
      ok(`purge_tombstones() refused (${error.code ?? error.message})`);
    }
  }
}

/* ------------------------------------------------------------------ */

console.log(
  failures === 0
    ? '\n\x1b[32m✓ project is configured correctly\x1b[0m\n'
    : `\n\x1b[31m✗ ${failures} check(s) failed\x1b[0m\n`,
);
process.exit(failures === 0 ? 0 : 1);
