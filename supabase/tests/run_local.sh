#!/usr/bin/env bash
#
# Applies the schema to a throwaway PostgreSQL cluster and runs the SQL tests.
#
# WHY THIS EXISTS
#   RLS is the entire security model for this data, and sync_push holds the
#   conflict rules that decide which of two phones' versions of a seizure
#   record survives. Neither is the kind of thing to verify by reading it, and
#   neither can be exercised from the app's own test suite.
#
# Needs only a PostgreSQL install (initdb + pg_ctl + psql) — no Docker, no
# Supabase CLI. Everything is created under a temp directory and torn down.
#
#   ./supabase/tests/run_local.sh
#
# Exits non-zero on the first failure, so it is CI-ready as-is.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

# Short path on purpose: a unix socket path is capped at ~103 bytes, and the
# usual mktemp -d under /var/folders on macOS blows straight past that.
RUNDIR="${PAWTRACK_PGDIR:-/tmp/pawtrack-pgtest}"
DATA="$RUNDIR/data"

PGBIN="${PGBIN:-}"
if [[ -z "$PGBIN" ]]; then
  if command -v initdb >/dev/null 2>&1; then
    PGBIN="$(dirname "$(command -v initdb)")"
  else
    PGBIN="$(ls -d /Library/PostgreSQL/*/bin /usr/lib/postgresql/*/bin 2>/dev/null | tail -1 || true)"
  fi
fi
if [[ -z "$PGBIN" || ! -x "$PGBIN/initdb" ]]; then
  echo "Could not find PostgreSQL binaries. Set PGBIN=/path/to/pg/bin" >&2
  exit 1
fi

cleanup() {
  "$PGBIN/pg_ctl" -D "$DATA" stop -m immediate >/dev/null 2>&1 || true
  rm -rf "$RUNDIR"
}
trap cleanup EXIT

cleanup
mkdir -p "$DATA"

echo "→ initdb"
"$PGBIN/initdb" -D "$DATA" -U postgres --auth=trust >/dev/null

echo "→ starting postgres"
"$PGBIN/pg_ctl" -D "$DATA" \
  -o "-k $RUNDIR -c listen_addresses=''" \
  -l "$RUNDIR/pg.log" start >/dev/null
sleep 2

psql_run() { "$PGBIN/psql" -h "$RUNDIR" -U postgres -v ON_ERROR_STOP=1 "$@"; }

echo "→ supabase stub"
psql_run -q -f "$ROOT/supabase/tests/00_local_stub.sql"

# The migrations are idempotent, so they emit a "does not exist, skipping"
# NOTICE for every drop-if-exists on a first run. Suppressed here rather than
# grepped away, because the TEST files below report their verdict via NOTICE
# and must keep it.
echo "→ migrations"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "   $(basename "$f")"
  PGOPTIONS='-c client_min_messages=warning' psql_run -q -f "$f"
done

# A foreign key with no usable index turns every ON DELETE CASCADE into a
# sequential scan — and account deletion is one cascade from auth.users across
# every table. Asserted rather than fixed once, because adding a table
# reintroduces it silently and nothing else would notice.
echo "→ foreign key indexes"
UNINDEXED=$(psql_run -X -tAc "
  select coalesce(string_agg(conrelid::regclass::text || '.' || a.attname, ', '), '')
    from pg_constraint c
    join pg_attribute a
      on a.attrelid = c.conrelid and a.attnum = any (c.conkey)
   where c.contype = 'f'
     and c.connamespace = 'public'::regnamespace
     and not exists (
       select 1 from pg_index i
        where i.indrelid = c.conrelid
          and a.attnum = i.indkey[0]   -- must LEAD the index
          and i.indpred is null        -- a partial index cannot serve a cascade
     );")
if [[ -n "$UNINDEXED" ]]; then
  echo "   ✗ foreign keys with no usable index: $UNINDEXED" >&2
  echo "     add them to supabase/migrations/20260828000600_fk_indexes.sql" >&2
  exit 1
fi
echo "   ✓ every foreign key is indexed"

# Postgres grants EXECUTE on every new function to PUBLIC, and anon inherits
# from PUBLIC — so a SECURITY DEFINER function in `public` is an unauthenticated
# API endpoint the moment it is created, unless it is explicitly revoked FROM
# PUBLIC. Revoking from `anon, authenticated` by name does NOT do it, which is
# how purge_tombstones() ended up callable by anyone holding the public key.
echo "→ security definer exposure"
EXPOSED=$(psql_run -X -tAc "
  select coalesce(string_agg(p.proname, ', '), '')
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.prosecdef
     and has_function_privilege('anon', p.oid, 'EXECUTE');")
if [[ -n "$EXPOSED" ]]; then
  echo "   ✗ SECURITY DEFINER functions callable by anon: $EXPOSED" >&2
  echo "     revoke them FROM PUBLIC, not just from anon/authenticated" >&2
  exit 1
fi
echo "   ✓ no security definer function is reachable by anon"

echo "→ tests"
for t in rls_smoke_test sync_push_test; do
  psql_run -f "$ROOT/supabase/tests/$t.sql" 2>&1 | grep -E 'PASS|FAIL|ERROR' || {
    echo "   $t produced no verdict" >&2
    exit 1
  }
done

echo "✓ schema, RLS and sync_push all verified"
