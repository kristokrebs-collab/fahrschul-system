-- 0001_core.sql – Trading-Journal core schema (Wave-0 contract, owner P09).
--
-- Run order: 0001_core → 0002_billing (P10) → 0003_exchange (P11) → 0004_social (P12). Supabase project in the EU
-- (Frankfurt). See supabase/README.md for the external setup (Auth, Storage buckets, Realtime).
--
-- Conventions
-- - RLS is enabled on EVERY table. Client policies compare with `(select auth.uid())` (evaluated once per query).
-- - Anything that must be trustworthy (plan, audit trail, error log, exchange secrets, rate limits) is written only
--   by the service role, i.e. the Netlify functions (netlify/functions/_lib). Supabase's default grants on new public
--   tables are revoked and re-granted per column where clients need them.
-- - Journal data is local-first: `journal_docs` mirrors the browser store; deletes are tombstones (`deleted = true`).

-- ── Helpers ─────────────────────────────────────────────────────────────────────────────────────────────────────

create function public.touch_updated_at() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end $$;

-- aal2 is required as soon as the user has a verified MFA factor (restrictive policies below).
create function public.mfa_satisfied() returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      or not exists (
        select 1 from auth.mfa_factors f
        where f.user_id = auth.uid() and f.status = 'verified'
      );
$$;
revoke execute on function public.mfa_satisfied() from public, anon;
grant execute on function public.mfa_satisfied() to authenticated, service_role;

-- ── profiles ────────────────────────────────────────────────────────────────────────────────────────────────────
-- One row per auth user (created by trigger). plan / plan_status / trial_end are written ONLY by the Stripe webhook
-- (P10, service role); the client may change display_name, tz and privacy.

create table public.profiles (
  id           uuid primary key references auth.users (id) on delete cascade,
  display_name text check (display_name is null or char_length(display_name) <= 80),
  plan         text not null default 'free'
               check (plan in ('free', 'pro', 'premium', 'team')),
  plan_status  text not null default 'none'
               check (plan_status in ('none', 'trialing', 'active', 'past_due', 'canceled', 'incomplete',
                                      'incomplete_expired', 'unpaid', 'paused')),
  trial_end    timestamptz,
  tz           text not null default 'Europe/Berlin' check (char_length(tz) between 1 and 64),
  -- { "sync": bool, "telemetry": bool, "leaderboard": bool, … } – opt-ins (P09 PrivacyCard, P12 leaderboard)
  privacy      jsonb not null default '{}'::jsonb check (jsonb_typeof(privacy) = 'object'),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

create trigger profiles_touch before update on public.profiles
  for each row execute function public.touch_updated_at();

alter table public.profiles enable row level security;
create policy "profiles: read own" on public.profiles
  for select to authenticated using ((select auth.uid()) = id);
create policy "profiles: update own" on public.profiles
  for update to authenticated using ((select auth.uid()) = id) with check ((select auth.uid()) = id);

revoke all on public.profiles from anon, authenticated;
grant select on public.profiles to authenticated;
grant update (display_name, tz, privacy) on public.profiles to authenticated;

create function public.handle_new_user() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  insert into public.profiles (id) values (new.id) on conflict (id) do nothing;
  return new;
end $$;
revoke execute on function public.handle_new_user() from public, anon, authenticated;

create trigger on_auth_user_created after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── journal_docs ────────────────────────────────────────────────────────────────────────────────────────────────
-- The synced journal: one row per record. kind = 'trade' | 'hyblock' | 'settings' | 'day' | … (P09 adapter),
-- id = the client id (t_…, h_…, 'settings', 'YYYY-MM-DD'). `data` is the record verbatim (passthrough fields such as
-- `signal` / `boxSnap` must round-trip). updated_at / rev are stamped by the server (client clocks do not matter);
-- the record's own `data.updatedAt` decides "newer wins" on the client. Settings use `rev` as an optimistic lock:
--   update … set data = $merged where user_id = … and kind = 'settings' and id = 'settings' and rev = $seen
-- (0 rows → refetch, merge3, retry).

create table public.journal_docs (
  user_id           uuid not null default auth.uid() references auth.users (id) on delete cascade,
  kind              text not null check (kind ~ '^[a-z][a-z0-9_]{0,31}$'),
  id                text not null check (char_length(id) between 1 and 128),
  data              jsonb not null default '{}'::jsonb,
  deleted           boolean not null default false,
  rev               bigint not null default 1,
  client_updated_at timestamptz,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  primary key (user_id, kind, id),
  constraint journal_docs_data_size check (pg_column_size(data) <= 1048576)
);
create index journal_docs_user_updated on public.journal_docs (user_id, updated_at);

create function public.journal_docs_stamp() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  if tg_op = 'UPDATE' then
    new.rev := old.rev + 1;
    new.created_at := old.created_at;
  else
    new.rev := 1;
    new.created_at := now();
  end if;
  return new;
end $$;

create trigger journal_docs_stamp before insert or update on public.journal_docs
  for each row execute function public.journal_docs_stamp();

alter table public.journal_docs enable row level security;
create policy "journal_docs: read own" on public.journal_docs
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "journal_docs: insert own" on public.journal_docs
  for insert to authenticated with check ((select auth.uid()) = user_id);
create policy "journal_docs: update own" on public.journal_docs
  for update to authenticated using ((select auth.uid()) = user_id) with check ((select auth.uid()) = user_id);
-- No delete policy: deletes are tombstones (offline devices must not resurrect a record, and Realtime does not apply
-- RLS to DELETE events). Purging tombstones / account deletion runs with the service role.
create policy "journal_docs: mfa" on public.journal_docs as restrictive
  for all to authenticated using (public.mfa_satisfied()) with check (public.mfa_satisfied());

revoke all on public.journal_docs from anon, authenticated;
grant select, insert, update on public.journal_docs to authenticated;

-- Realtime (postgres_changes, filter user_id=eq.<uid>). Supabase creates the publication; elsewhere this is a no-op.
-- If it is skipped here, enable it in the dashboard: Database → Publications → supabase_realtime → journal_docs.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                     where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'journal_docs') then
    alter publication supabase_realtime add table public.journal_docs;
  end if;
end $$;

-- ── rate_hits + rate_hit() ──────────────────────────────────────────────────────────────────────────────────────
-- Fixed-window counters for netlify/functions/_lib/rateLimit.ts. Service role only.

create table public.rate_hits (
  key          text not null check (char_length(key) <= 200),
  window_start timestamptz not null,
  hits         integer not null default 0,
  primary key (key, window_start)
);
alter table public.rate_hits enable row level security;
revoke all on public.rate_hits from anon, authenticated;

create function public.rate_hit(p_key text, p_window_sec integer) returns integer
language plpgsql security definer set search_path = '' as $$
declare
  w timestamptz;
  n integer;
begin
  if p_key is null or p_window_sec is null or p_window_sec < 1 or p_window_sec > 86400 then
    raise exception 'rate_hit: invalid arguments';
  end if;
  w := to_timestamp(floor(extract(epoch from now()) / p_window_sec) * p_window_sec);
  insert into public.rate_hits as r (key, window_start, hits) values (p_key, w, 1)
    on conflict (key, window_start) do update set hits = r.hits + 1
    returning r.hits into n;
  if random() < 0.01 then
    delete from public.rate_hits where window_start < now() - interval '2 days';
  end if;
  return n;
end $$;
revoke execute on function public.rate_hit(text, integer) from public, anon, authenticated;
grant execute on function public.rate_hit(text, integer) to service_role;

-- ── audit_log ───────────────────────────────────────────────────────────────────────────────────────────────────
-- Security-relevant actions (netlify/functions/_lib/audit.ts). Users read their own trail; only functions write.
-- On account deletion the rows stay without the user id (on delete set null).

create table public.audit_log (
  id      bigint generated always as identity primary key,
  user_id uuid references auth.users (id) on delete set null,
  action  text not null check (char_length(action) <= 64),
  meta    jsonb not null default '{}'::jsonb,
  ip_hash text check (ip_hash is null or char_length(ip_hash) <= 64),
  at      timestamptz not null default now()
);
create index audit_log_user_at on public.audit_log (user_id, at desc);

alter table public.audit_log enable row level security;
create policy "audit_log: read own" on public.audit_log
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.audit_log from anon, authenticated;
grant select on public.audit_log to authenticated;

-- ── app_errors ──────────────────────────────────────────────────────────────────────────────────────────────────
-- Client error reports via /api/v1/log (sampled, PII-stripped, telemetry opt-in). Service role only; purge > 30 days.

create table public.app_errors (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  user_id     uuid references auth.users (id) on delete set null,
  fingerprint text check (fingerprint is null or char_length(fingerprint) <= 64),
  message     text not null check (char_length(message) <= 2000),
  stack       text check (stack is null or char_length(stack) <= 8000),
  url         text check (url is null or char_length(url) <= 500),
  release     text check (release is null or char_length(release) <= 64),
  edition     text check (edition is null or edition in ('personal', 'share')),
  ua          text check (ua is null or char_length(ua) <= 300),
  meta        jsonb not null default '{}'::jsonb
);
create index app_errors_at on public.app_errors (at desc);

alter table public.app_errors enable row level security;
revoke all on public.app_errors from anon, authenticated;

-- ── exchange_connections ────────────────────────────────────────────────────────────────────────────────────────
-- Read-only exchange API keys (P11). The *_enc columns hold AES-256-GCM blobs 'v<n>:<iv>:<tag>:<ct>'
-- (netlify/functions/_lib/crypto.ts, AAD '<user_id>:<connection id>:<field>'). Clients can see the metadata of their
-- own connections but have NO privilege on the secret columns (`select *` is refused – list columns explicitly);
-- connect / disconnect / sync run in functions with the service role.

create table public.exchange_connections (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references auth.users (id) on delete cascade,
  exchange       text not null check (exchange in ('bitunix', 'binance', 'bybit', 'okx')),
  label          text not null default '' check (char_length(label) <= 40),
  api_key_enc    text not null,
  secret_enc     text not null,
  passphrase_enc text,
  key_version    smallint not null default 1 check (key_version >= 1),
  key_last4      text not null default '' check (char_length(key_last4) <= 4),
  -- the key's rights as the VENUE reports them. Bitunix has no endpoint for that: the connect call only proves the key
  -- can read (GET /api/v1/futures/account) and stores {} – trade / withdraw rights can NOT be detected or rejected; the
  -- user confirms "read-only" when connecting and the UI says exactly that (review EX-01)
  permissions    text[] not null default '{}',
  status         text not null default 'active' check (status in ('active', 'invalid', 'revoked', 'paused')),
  last_sync_at   timestamptz,
  last_error     text check (last_error is null or char_length(last_error) <= 300),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  unique (user_id, exchange, label)
);
create index exchange_connections_user on public.exchange_connections (user_id);

create trigger exchange_connections_touch before update on public.exchange_connections
  for each row execute function public.touch_updated_at();

alter table public.exchange_connections enable row level security;
create policy "exchange_connections: read own" on public.exchange_connections
  for select to authenticated using ((select auth.uid()) = user_id);
create policy "exchange_connections: mfa" on public.exchange_connections as restrictive
  for select to authenticated using (public.mfa_satisfied());

revoke all on public.exchange_connections from anon, authenticated;
grant select (id, user_id, exchange, label, key_version, key_last4, permissions, status, last_sync_at, last_error,
              created_at, updated_at)
  on public.exchange_connections to authenticated;

-- ── Sessions (Konto → Sicherheit) ───────────────────────────────────────────────────────────────────────────────
-- Lists the caller's own login sessions (devices). The IP is coarsened (/24, /48) – enough to tell "home" from
-- "somewhere else", never the full address. Signing the other devices out runs through Supabase Auth
-- (`auth.signOut({ scope: "others" })`), not through SQL.

create function public.my_sessions()
returns table (
  id           uuid,
  created_at   timestamptz,
  updated_at   timestamptz,
  refreshed_at timestamptz,
  user_agent   text,
  ip           text,
  aal          text,
  is_current   boolean
)
language sql stable security definer set search_path = '' as $$
  select s.id,
         s.created_at,
         s.updated_at,
         s.refreshed_at::timestamptz,
         left(s.user_agent, 300),
         case
           when s.ip is null then null
           when family(s.ip) = 4 then regexp_replace(host(network(set_masklen(s.ip, 24))), '\.0$', '.x')
           else host(network(set_masklen(s.ip, 48))) || '…'
         end,
         s.aal::text,
         coalesce(s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid, false)
  from auth.sessions s
  where s.user_id = auth.uid()
    and (s.not_after is null or s.not_after > now())
  order by coalesce(s.id = nullif(auth.jwt() ->> 'session_id', '')::uuid, false) desc,
           coalesce(s.refreshed_at::timestamptz, s.updated_at, s.created_at) desc nulls last
  limit 50;
$$;
revoke execute on function public.my_sessions() from public, anon;
grant execute on function public.my_sessions() to authenticated;

-- ── Nightly backups (netlify/functions/backup-nightly.mts) ──────────────────────────────────────────────────────
-- Users whose journal changed since `p_since`, keyset-paged by user id. Service role only.

create function public.backup_candidates(p_since timestamptz, p_after uuid default null, p_limit integer default 500)
returns table (user_id uuid)
language sql stable security definer set search_path = '' as $$
  select distinct d.user_id
  from public.journal_docs d
  where d.updated_at >= p_since
    and (p_after is null or d.user_id > p_after)
  order by d.user_id
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;
revoke execute on function public.backup_candidates(timestamptz, uuid, integer) from public, anon, authenticated;
grant execute on function public.backup_candidates(timestamptz, uuid, integer) to service_role;

-- ── Storage buckets ─────────────────────────────────────────────────────────────────────────────────────────────
-- `backups`: private, service role only (no client policy) – `backups/<user id>/<YYYY-MM-DD>.json`, kept 14 days.
-- `screenshots` (P06): private, every user reads / writes only below `screenshots/<own user id>/…`.
-- Skipped where the storage schema does not exist (plain Postgres); create both buckets in the dashboard then.

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'buckets') then
    insert into storage.buckets (id, name, public) values ('backups', 'backups', false) on conflict (id) do nothing;
    insert into storage.buckets (id, name, public) values ('screenshots', 'screenshots', false) on conflict (id) do nothing;
  end if;
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute $p$create policy "screenshots: read own" on storage.objects for select to authenticated
      using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    execute $p$create policy "screenshots: insert own" on storage.objects for insert to authenticated
      with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    execute $p$create policy "screenshots: update own" on storage.objects for update to authenticated
      using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text)
      with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
    execute $p$create policy "screenshots: delete own" on storage.objects for delete to authenticated
      using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text)$p$;
  end if;
end $$;
