-- 0007_seats_screenshots.sql – paid seats are a hard limit, the screenshots bucket has limits (reviews MONEY-03, STOR-01).
--
-- Run after 0006. Two independent fixes:
--
-- 1. Team seats (MONEY-03). `assignSeat` (netlify/functions/_lib/stripe.ts) read the seat usage and inserted into
--    team_seats in two steps; two members joining at the same moment both saw a free seat, and the team had one member
--    more than paid. `assign_team_seat()` takes a transaction-scoped advisory lock per owner, then counts and inserts
--    in one transaction – concurrent joins of one team run one after the other. Service role only. Without 0007 the
--    function falls back to the old two-step write.
--
-- 2. Screenshots bucket (STOR-01). 0001 created it without limits, and the storage policies let every signed-in user
--    – a Free plan included – upload below their own folder; the Pro-only `screenshotsCloud` gate existed only in the
--    client. Now:
--      - at most 5 MB per object, only PNG / JPEG / WebP / GIF (the client re-encodes larger pictures to WebP);
--      - upload and overwrite need a plan with `screenshotsCloud` (pro, premium, team – `src/billing/plans.ts`; a unit
--        test keeps the two lists equal) while payments are switched on. Reading and deleting stay allowed after a
--        downgrade, so nobody loses access to their own pictures.
--    Whether payments are on is known only to the functions (Stripe keys are Netlify env): they write it into
--    `app_config` ('billing' → {"paymentsEnabled": true|false}) from billing/status and the Stripe webhook. Until that
--    row exists the bucket stays open, exactly like every other gate without payments (a deployment without Stripe
--    has no paywall at all).

-- ── app_config: server-written switches the database needs to know ────────────────────────────────────────────────

create table if not exists public.app_config (
  key        text primary key check (char_length(key) <= 64),
  value      jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);
alter table public.app_config enable row level security;
revoke all on public.app_config from anon, authenticated;

-- ── team seats ──────────────────────────────────────────────────────────────────────────────────────────────────

create or replace function public.assign_team_seat(p_owner uuid, p_member uuid, p_seats integer)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_used integer;
begin
  if p_owner is null or p_member is null or p_owner = p_member then
    return 'invalid_member';
  end if;
  -- one team at a time: concurrent joins of this owner wait here until the first transaction ends
  perform pg_advisory_xact_lock(hashtextextended('team_seats:' || p_owner::text, 0));
  if exists (select 1 from public.team_seats where member_id = p_member) then
    return 'seat_taken';
  end if;
  select count(*) into v_used from public.team_seats where owner_id = p_owner;
  -- the owner takes one seat
  if 1 + v_used >= coalesce(p_seats, 0) then
    return 'no_seats';
  end if;
  insert into public.team_seats (owner_id, member_id) values (p_owner, p_member);
  return 'ok';
end $$;
revoke execute on function public.assign_team_seat(uuid, uuid, integer) from public, anon, authenticated;
grant execute on function public.assign_team_seat(uuid, uuid, integer) to service_role;

-- ── screenshots: plan gate ──────────────────────────────────────────────────────────────────────────────────────

-- True when `p_uid` may store screenshots in the cloud: payments are off (or not reported yet), or the profile's plan
-- includes `screenshotsCloud` and its status grants the plan (active / trialing / past_due – `grantsPlan`).
create or replace function public.cloud_shots_allowed(p_uid uuid)
returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce((select (c.value ->> 'paymentsEnabled')::boolean from public.app_config c where c.key = 'billing'), false) is not true
      or exists (
        select 1 from public.profiles p
        where p.id = p_uid
          and p.plan in ('pro', 'premium', 'team')
          and p.plan_status in ('active', 'trialing', 'past_due')
      );
$$;
revoke execute on function public.cloud_shots_allowed(uuid) from public, anon;
grant execute on function public.cloud_shots_allowed(uuid) to authenticated, service_role;

-- ── screenshots: bucket limits + policies ───────────────────────────────────────────────────────────────────────
-- Upload / overwrite get the plan check on top of the own-folder + aal2 rule of 0005; read / delete stay as in 0005.
-- Skipped where the storage schema does not exist (plain Postgres); set the limits in the dashboard then.

do $$
begin
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'file_size_limit') then
    execute $u$update storage.buckets set file_size_limit = 5242880 where id = 'screenshots'$u$;
  end if;
  if exists (select 1 from information_schema.columns where table_schema = 'storage' and table_name = 'buckets' and column_name = 'allowed_mime_types') then
    execute $u$update storage.buckets set allowed_mime_types = array['image/png', 'image/jpeg', 'image/webp', 'image/gif'] where id = 'screenshots'$u$;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute 'drop policy if exists "screenshots: insert own" on storage.objects';
    execute 'drop policy if exists "screenshots: update own" on storage.objects';
    execute $p$create policy "screenshots: insert own" on storage.objects for insert to authenticated
      with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
                  and public.mfa_satisfied() and public.cloud_shots_allowed((select auth.uid())))$p$;
    execute $p$create policy "screenshots: update own" on storage.objects for update to authenticated
      using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
             and public.mfa_satisfied())
      with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
                  and public.mfa_satisfied() and public.cloud_shots_allowed((select auth.uid())))$p$;
  end if;
end $$;
