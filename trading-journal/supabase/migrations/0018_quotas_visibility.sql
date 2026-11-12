-- 0018_quotas_visibility.sql – quotas the database enforces itself, mentor-aware group visibility, a caller-bound plan gate
-- (security audit round 11, package B: lens 1 findings 2 / 5 / 14, lens 3 finding 4).
--
-- Run after 0017. Until now the quotas of `src/billing/plans.ts` were promises of the browser and of the functions: a signed-in user
-- who talks to PostgREST directly (no app in between) could fill `journal_docs` and `simulations` without limit, upload without a
-- sum limit into the `screenshots` bucket, read who sits in a mentor group next to them, and ask `cloud_shots_allowed()` about other
-- people's plans. Four independent parts:
--
-- 1. Quotas (triggers + one counter table). The browser's own writes are limited, the functions (service role) keep writing:
--      - `journal_docs`: at most 100 000 rows and 256 MiB of JSON per user (the 1 MiB per row stays). Counters in `user_usage`.
--      - `simulations`: new simulations per UTC day by plan (Free 20 / Pro 200 – `plans.ts`; Premium / Team are "unlimited" there,
--        the database caps them at 2 000 per day) and at most 5 000 stored per user. Counters in `usage_daily`.
--      - `screenshots` bucket: the summed object sizes of the caller's folder by plan (Pro 2 GB, Premium / Team 20 GB – `plans.ts`),
--        checked on upload and overwrite. The size of the file being uploaded is not known to the policy, so the sum can pass the
--        limit by that one file (at most the 5 MB per object of 0007).
--      - `backups` bucket: at most 512 MiB per object (twice the journal limit: the nightly backup is that JSON plus an envelope).
--    A refused write raises SQLSTATE P0001 with a message `quota_exceeded:<what>` (PostgREST answers 400; the sync client does not
--    treat it as retryable). Whoever is above a limit can still shrink: updates that do not grow a row, tombstones and deletes pass.
--    The numbers without a counterpart in `plans.ts` (journal rows / bytes, stored simulations, the two caps, the backup object)
--    are proposals the operator confirms (E8) – `docs/TARIFE.md` lists them.
--
-- 2. Group visibility (finding 5). 0004 let every member of a group read all rows of `group_members` and the pseudonyms of every
--    co-member. In a MENTOR group the functions hide the students from each other, the policies did not. Now a student sees the
--    mentors and their own row, owners / mentors see everyone; in 'group' and 'team' groups nothing changes. The same rule governs
--    `social_profiles` through `shares_group_with()`.
--
-- 3. `cloud_shots_allowed(uuid)` (finding 14) ignores its argument for a signed-in caller and answers about the caller's own plan; only
--    a call without a user (the service role) names the user. The storage policies call it with `auth.uid()` anyway.
--
-- 4. `search_path` / EXECUTE: every function below is pinned to an empty `search_path`; the helpers that take a user id or write the
--    counters are SECURITY DEFINER and not executable for `anon` / `authenticated`.

-- ── numbers ─────────────────────────────────────────────────────────────────────────────────────────────────────────────

-- Limits that do not depend on the plan.
create function public.quota_cap(p_key text) returns bigint
language sql immutable set search_path = '' as $$
  select case p_key
    when 'journal_rows' then 100000::bigint
    when 'journal_bytes' then 268435456::bigint            -- 256 MiB
    when 'simulations_rows' then 5000::bigint
    when 'simulations_per_day_cap' then 2000::bigint       -- what "unlimited" (Premium / Team) is capped at in the database
    when 'screenshot_objects' then 100000::bigint
    when 'backup_object_bytes' then 536870912::bigint      -- 512 MiB
  end;
$$;

-- Limits per plan, the numbers of `src/billing/plans.ts` (`PLAN_LIMITS`); a unit test keeps both tables equal.
-- `simulations_per_day`: Free 20, Pro 200, Premium / Team unlimited in plans.ts → `quota_cap('simulations_per_day_cap')`.
-- `screenshot_mb`: Free 0, Pro 2048, Premium / Team 20480.
create function public.plan_limit(p_plan text, p_key text) returns bigint
language sql immutable set search_path = '' as $$
  select case p_key
    when 'simulations_per_day' then case p_plan when 'free' then 20::bigint when 'pro' then 200::bigint else public.quota_cap('simulations_per_day_cap') end
    when 'screenshot_mb' then case p_plan when 'free' then 0::bigint when 'pro' then 2048::bigint else 20480::bigint end
  end;
$$;

-- The plan that counts for `p_uid` right now: while payments are off (or not reported yet – `app_config` 'billing', see 0007) there is
-- no paywall, so the top plan; otherwise the profile's paid plan while its status grants it (`grantsPlan`), else 'free'.
create function public.effective_plan(p_uid uuid) returns text
language sql stable security definer set search_path = '' as $$
  select case
    when coalesce((select (c.value ->> 'paymentsEnabled')::boolean from public.app_config c where c.key = 'billing'), false) is not true then 'premium'
    else coalesce(
      (select p.plan from public.profiles p
       where p.id = p_uid and p.plan in ('pro', 'premium', 'team') and p.plan_status in ('active', 'trialing', 'past_due')),
      'free')
  end;
$$;
revoke execute on function public.effective_plan(uuid) from public, anon, authenticated;
grant execute on function public.effective_plan(uuid) to service_role;

-- ── counters (service only) ──────────────────────────────────────────────────────────────────────────────────────────────

create table public.user_usage (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  doc_rows   bigint not null default 0 check (doc_rows >= 0),
  doc_bytes  bigint not null default 0 check (doc_bytes >= 0),
  updated_at timestamptz not null default now()
);
alter table public.user_usage enable row level security;
revoke all on public.user_usage from anon, authenticated;

create table public.usage_daily (
  user_id uuid not null references auth.users (id) on delete cascade,
  kind    text not null check (kind ~ '^[a-z_]{1,32}$'),
  day     date not null,
  n       integer not null default 0 check (n >= 0),
  primary key (user_id, kind, day)
);
alter table public.usage_daily enable row level security;
revoke all on public.usage_daily from anon, authenticated;

-- Recounts the journal counters from the table itself (all users, or one): used once below for the data that exists today and by the
-- operator should a counter ever be doubted (`select public.recount_usage();` in the SQL editor). Service role only.
create function public.recount_usage(p_user uuid default null) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  n integer;
begin
  insert into public.user_usage as u (user_id, doc_rows, doc_bytes)
    select d.user_id, count(*), coalesce(sum(octet_length(d.data::text)), 0)
    from public.journal_docs d
    where p_user is null or d.user_id = p_user
    group by d.user_id
    on conflict (user_id) do update set doc_rows = excluded.doc_rows, doc_bytes = excluded.doc_bytes, updated_at = now();
  get diagnostics n = row_count;
  -- accounts whose journal is empty now
  update public.user_usage u set doc_rows = 0, doc_bytes = 0, updated_at = now()
   where (p_user is null or u.user_id = p_user)
     and not exists (select 1 from public.journal_docs d where d.user_id = u.user_id);
  return n;
end $$;
revoke execute on function public.recount_usage(uuid) from public, anon, authenticated;
grant execute on function public.recount_usage(uuid) to service_role;

-- what the journal holds today (the triggers keep it up to date from here on)
select public.recount_usage();

-- ── journal_docs: rows + bytes per user ──────────────────────────────────────────────────────────────────────────────────
-- BEFORE (not AFTER) because one upsert statement carries up to 200 rows: AFTER triggers run only once the whole statement is
-- done, so every row would see the same counters. The counter row is locked FOR UPDATE, so two devices of one user take turns.
-- Only the browser (database role `authenticated`) is refused; the functions (service role, dashboard) are counted but never blocked.

create function public.journal_docs_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_browser boolean := coalesce(current_setting('role', true), '') = 'authenticated';
  v_old     bigint := 0;
  v_new     bigint;
  v_rows    bigint;
  v_bytes   bigint;
  v_exists  boolean;
  d_rows    bigint := 0;
begin
  -- a row for someone else is refused by the policy right after this trigger; do not touch (or reveal) that person's counters
  if v_browser and new.user_id is distinct from auth.uid() then
    return new;
  end if;
  v_new := octet_length(new.data::text);
  if tg_op = 'INSERT' then
    -- an upsert of an existing row arrives here first and becomes an UPDATE (its own trigger run counts the change)
    select true into v_exists from public.journal_docs d where d.user_id = new.user_id and d.kind = new.kind and d.id = new.id;
    if coalesce(v_exists, false) then
      return new;
    end if;
    d_rows := 1;
  else
    v_old := octet_length(old.data::text);
  end if;
  insert into public.user_usage (user_id) values (new.user_id) on conflict (user_id) do nothing;
  select u.doc_rows, u.doc_bytes into v_rows, v_bytes from public.user_usage u where u.user_id = new.user_id for update;
  if v_browser then
    if d_rows > 0 and v_rows + d_rows > public.quota_cap('journal_rows') then
      raise exception 'quota_exceeded:journal_rows' using errcode = 'P0001', hint = 'The journal holds the most records an account may sync.';
    end if;
    if v_new - v_old > 0 and v_bytes + (v_new - v_old) > public.quota_cap('journal_bytes') then
      raise exception 'quota_exceeded:journal_bytes' using errcode = 'P0001', hint = 'The journal holds the most data an account may sync.';
    end if;
  end if;
  update public.user_usage u
     set doc_rows = greatest(0, u.doc_rows + d_rows), doc_bytes = greatest(0, u.doc_bytes + (v_new - v_old)), updated_at = now()
   where u.user_id = new.user_id;
  return new;
end $$;
revoke execute on function public.journal_docs_quota() from public, anon, authenticated;

create trigger journal_docs_quota before insert or update on public.journal_docs
  for each row execute function public.journal_docs_quota();

-- Hard deletes (purge of tombstones, account deletion) give the room back. UPDATE only: while an account is being deleted the
-- auth user is already gone, a new counter row would break its foreign key.
create function public.journal_docs_unquota() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  update public.user_usage u
     set doc_rows = greatest(0, u.doc_rows - 1), doc_bytes = greatest(0, u.doc_bytes - octet_length(old.data::text)), updated_at = now()
   where u.user_id = old.user_id;
  return old;
end $$;
revoke execute on function public.journal_docs_unquota() from public, anon, authenticated;

create trigger journal_docs_unquota after delete on public.journal_docs
  for each row execute function public.journal_docs_unquota();

-- ── simulations: per day by plan, and stored in total ───────────────────────────────────────────────────────────────────

create function public.simulations_quota() returns trigger
language plpgsql security definer set search_path = '' as $$
declare
  v_browser boolean := coalesce(current_setting('role', true), '') = 'authenticated';
  v_day     date := (now() at time zone 'utc')::date;
  v_n       integer;
  v_stored  bigint;
  v_exists  boolean;
begin
  if v_browser and new.user_id is distinct from auth.uid() then
    return new;
  end if;
  -- an upsert of a simulation that is already stored is not a new one
  select true into v_exists from public.simulations s where s.user_id = new.user_id and s.id = new.id;
  if coalesce(v_exists, false) then
    return new;
  end if;
  -- one user at a time (same lock row as the journal counters), so parallel requests cannot all pass the check
  insert into public.user_usage (user_id) values (new.user_id) on conflict (user_id) do nothing;
  perform 1 from public.user_usage u where u.user_id = new.user_id for update;
  select coalesce(max(c.n), 0) into v_n from public.usage_daily c where c.user_id = new.user_id and c.kind = 'simulations' and c.day = v_day;
  if v_browser then
    if v_n >= public.plan_limit(public.effective_plan(new.user_id), 'simulations_per_day') then
      raise exception 'quota_exceeded:simulations_per_day' using errcode = 'P0001', hint = 'The plan allows this many new simulations per day.';
    end if;
    select count(*) into v_stored from (select 1 from public.simulations s where s.user_id = new.user_id limit public.quota_cap('simulations_rows')) q;
    if v_stored >= public.quota_cap('simulations_rows') then
      raise exception 'quota_exceeded:simulations_rows' using errcode = 'P0001', hint = 'Delete saved simulations to make room.';
    end if;
  end if;
  insert into public.usage_daily as c (user_id, kind, day, n) values (new.user_id, 'simulations', v_day, 1)
    on conflict (user_id, kind, day) do update set n = c.n + 1;
  -- yesterday's counters are of no use any more
  delete from public.usage_daily c where c.user_id = new.user_id and c.kind = 'simulations' and c.day < v_day - 2;
  return new;
end $$;
revoke execute on function public.simulations_quota() from public, anon, authenticated;

create trigger simulations_quota before insert on public.simulations
  for each row execute function public.simulations_quota();

-- ── screenshots bucket: sum per user by plan; backups bucket: size of one object ─────────────────────────────────────────
-- Reads the caller from `auth.uid()` (no argument to abuse). `storage.objects.metadata ->> 'size'` is the stored size Supabase
-- Storage writes for every object; on a database without that column (plain Postgres) only the object count is checked.

create function public.screenshots_quota_ok() returns boolean
language plpgsql stable security definer set search_path = '' as $$
declare
  v_uid   uuid := auth.uid();
  v_used  bigint := 0;
  v_count bigint := 0;
  v_limit bigint;
begin
  if v_uid is null then
    return false;
  end if;
  v_limit := public.plan_limit(public.effective_plan(v_uid), 'screenshot_mb') * 1048576;
  if exists (select 1 from pg_catalog.pg_attribute a
             where a.attrelid = 'storage.objects'::regclass and a.attname = 'metadata' and not a.attisdropped) then
    execute $q$
      select coalesce(sum(case when (o.metadata ->> 'size') ~ '^[0-9]{1,15}$' then (o.metadata ->> 'size')::bigint else 0 end), 0), count(*)
      from storage.objects o
      where o.bucket_id = 'screenshots' and (storage.foldername(o.name))[1] = $1
    $q$
      using v_uid::text into v_used, v_count;
  else
    execute $q$
      select 0::bigint, count(*) from storage.objects o where o.bucket_id = 'screenshots' and (storage.foldername(o.name))[1] = $1
    $q$
      using v_uid::text into v_used, v_count;
  end if;
  return v_used < v_limit and v_count < public.quota_cap('screenshot_objects');
end $$;
revoke execute on function public.screenshots_quota_ok() from public, anon;
grant execute on function public.screenshots_quota_ok() to authenticated, service_role;

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute format($u$update storage.buckets set file_size_limit = %s where id = 'backups'$u$, public.quota_cap('backup_object_bytes'));
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute 'drop policy if exists "screenshots: insert own" on storage.objects';
    execute 'drop policy if exists "screenshots: update own" on storage.objects';
    execute $p$create policy "screenshots: insert own" on storage.objects for insert to authenticated
      with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
                  and public.mfa_satisfied() and public.cloud_shots_allowed((select auth.uid())) and public.screenshots_quota_ok())$p$;
    execute $p$create policy "screenshots: update own" on storage.objects for update to authenticated
      using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
             and public.mfa_satisfied())
      with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
                  and public.mfa_satisfied() and public.cloud_shots_allowed((select auth.uid())) and public.screenshots_quota_ok())$p$;
  end if;
end $$;

-- ── cloud_shots_allowed: the caller's own plan ────────────────────────────────────────────────────────────────────────────
-- Same answer as in 0007 (payments off → yes; otherwise a paid plan whose status grants it), but a signed-in caller can no longer
-- ask about somebody else: `p_uid` counts only when there is no signed-in user (the service role).

create or replace function public.cloud_shots_allowed(p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select public.effective_plan(coalesce(auth.uid(), p_uid)) in ('pro', 'premium', 'team');
$$;
revoke execute on function public.cloud_shots_allowed(uuid) from public, anon;
grant execute on function public.cloud_shots_allowed(uuid) to authenticated, service_role;

-- ── group visibility: mentor groups ──────────────────────────────────────────────────────────────────────────────────────
-- The caller may see `p_user` as a member of `p_group`: their own row; in 'group' / 'team' groups every co-member; in a 'mentor' group
-- owners / mentors see everyone, students see only the mentors (and themselves). Same rule as `can_see_review` / `can_see_hypothesis`.
create function public.can_see_member(p_group uuid, p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_members me
    join public.groups g on g.id = me.group_id
    join public.group_members t on t.group_id = me.group_id and t.user_id = p_user
    where me.group_id = p_group
      and me.user_id = auth.uid()
      and (g.kind <> 'mentor' or me.role in ('owner', 'mentor') or t.role in ('owner', 'mentor') or t.user_id = me.user_id)
  );
$$;
revoke execute on function public.can_see_member(uuid, uuid) from public, anon;
grant execute on function public.can_see_member(uuid, uuid) to authenticated, service_role;

drop policy "group_members: read co-members" on public.group_members;
create policy "group_members: read visible members" on public.group_members
  for select to authenticated using (public.can_see_member(group_id, user_id));

-- the pseudonym policy of 0004 calls this helper: now it follows the same rule (a group where the caller may see `p_user`)
create or replace function public.shares_group_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_members a
    join public.groups g on g.id = a.group_id
    join public.group_members b on b.group_id = a.group_id
    where a.user_id = auth.uid()
      and b.user_id = p_user
      and (g.kind <> 'mentor' or a.role in ('owner', 'mentor') or b.role in ('owner', 'mentor') or a.user_id = b.user_id)
  );
$$;
revoke execute on function public.shares_group_with(uuid) from public, anon;
grant execute on function public.shares_group_with(uuid) to authenticated, service_role;
