-- ============================================================================
-- Account deletion.
--
-- GDPR-relevant, and genuinely required of you once accounts exist: a user who
-- signs up must be able to leave and take their data with them.
--
-- Deleting the auth.users row cascades to every table here, because every
-- user_id column carries `references auth.users(id) on delete cascade`. That
-- is the whole server side of it.
--
-- The CLIENT still has to wipe local SQLite *and* the video files. Those files
-- are the one thing that exists nowhere else — the bytes never left the phone —
-- so an account deletion that only cleared the server would leave every
-- recording sitting in the app's document directory.
-- See src/services/sync/localData.ts.
-- ============================================================================

create or replace function public.delete_own_account()
returns void
language plpgsql
-- DEFINER is required: `authenticated` has no privileges on auth.users, and it
-- must not be granted any. The function is safe because it is not
-- parameterised — it can only ever delete the CALLER's row, and auth.uid()
-- comes from the verified JWT, not from anything the client passes.
security definer
set search_path = public, auth, pg_temp
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'delete_own_account: not authenticated';
  end if;

  -- Device rows are removed by the same cascade, but the alert log is
  -- deliberately cleared first and explicitly: it is the one table holding a
  -- record of this user that is not addressed by a policy they can see.
  delete from public.device_alerts where user_id = v_user;

  delete from auth.users where id = v_user;
end
$$;

revoke all on function public.delete_own_account() from anon, public;
grant execute on function public.delete_own_account() to authenticated;
