-- 0014_alerts.sql – Vier Alarme + Zustellung (C2): Einstellungen, Telefon-Einwilligung, Ereignisse, Zustellprotokoll, Jobs.
--
-- Run after 0001_core (touch_updated_at, mfa_satisfied), 0005_mfa_everywhere and 0008_alert_watch. (0011 = simulations,
-- 0012 = connections and 0013 = signals belong to other packages; the numbers do not depend on each other.)
--
-- What lives here
--   alert_prefs          the account's alarm settings (channels × four events, quiet hours, thresholds, markets). The client READS it;
--                        only the function `alerts-prefs` writes it (after the plan check: channels, telephone) – a client cannot
--                        switch on a channel the plan does not have.
--   alert_phones         telephone state without the number: status pending / verified / revoked, masked display, consent time and
--                        text version. Read by the client, written by the functions.
--   alert_phone_secrets  the number itself (AES-GCM blob, key = EXCHANGE_ENC_KEY_V<n>) and a keyed hash of it (one verified number per
--                        account). NO client access at all (RLS on, no policy, no grant). Deleted on opt-out.
--   alert_state          the engine's memory per account (phase, cycle, cooldown per market). Service role only.
--   alert_events         what the engine decided: one row per (account, dedupe key) – the UNIQUE constraint is the deduplication.
--   alert_deliveries     the delivery log (Zustellprotokoll): one row per (event, channel) with status queued / sending / ringing /
--                        answered / sent / shown / failed / skipped / dead and the reason. Tests and the old e-mail summary log here too.
--   jobs                 the work queue of the scheduled functions: lease (visibility timeout) + attempts + back-off + dead letter.
--
-- Guarantees the functions rely on
--   - an event exists at most once per dedupe key (`alert_enqueue` inserts event, deliveries and jobs in ONE statement block)
--   - a job is taken by one worker at a time (`jobs_claim`: FOR UPDATE SKIP LOCKED, lease); a worker that dies loses its lease and
--     the job is taken again; every completion is fenced by the lease token, so a late worker cannot overwrite a newer one
--   - a PHONE call is committed before it is dialed (`alert_phone_reserve`: budget check and `dialed_at` in one locked step); a job
--     taken over after a crash finds `dialed_at` and does NOT dial again
--
-- Own rows only for the client: select compares `user_id` with `auth.uid()`; 2FA accounts need aal2 (restrictive policy).

-- ── settings ────────────────────────────────────────────────────────────────────────────────────────────────────

create table public.alert_prefs (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  prefs      jsonb not null check (jsonb_typeof(prefs) = 'object' and pg_column_size(prefs) <= 8192),
  updated_at timestamptz not null default now()
);

create trigger alert_prefs_touch before update on public.alert_prefs
  for each row execute function public.touch_updated_at();

-- ── telephone ───────────────────────────────────────────────────────────────────────────────────────────────────

create table public.alert_phones (
  user_id         uuid primary key references auth.users (id) on delete cascade,
  status          text not null check (status in ('pending', 'verified', 'revoked')),
  -- "+49 ••• ••67": the first two and the last two digits, never enough to dial
  masked          text not null check (char_length(masked) <= 24),
  -- the explicit consent: when, and which text (version) the person agreed to
  consent_at      timestamptz not null,
  consent_version text not null check (char_length(consent_version) <= 40),
  verified_at     timestamptz,
  revoked_at      timestamptz,
  updated_at      timestamptz not null default now()
);

create trigger alert_phones_touch before update on public.alert_phones
  for each row execute function public.touch_updated_at();

create table public.alert_phone_secrets (
  user_id     uuid primary key references auth.users (id) on delete cascade,
  number_enc  text not null check (char_length(number_enc) <= 512),
  -- HMAC-SHA256 (hex) of the E.164 number: no second account may verify the same number
  number_hash text not null check (number_hash ~ '^[0-9a-f]{64}$'),
  verified    boolean not null default false,
  updated_at  timestamptz not null default now()
);

create unique index alert_phone_secrets_verified_hash on public.alert_phone_secrets (number_hash) where verified;

create trigger alert_phone_secrets_touch before update on public.alert_phone_secrets
  for each row execute function public.touch_updated_at();

-- ── engine memory ───────────────────────────────────────────────────────────────────────────────────────────────

create table public.alert_state (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  memory     jsonb not null default '{}'::jsonb check (jsonb_typeof(memory) = 'object' and pg_column_size(memory) <= 65536),
  updated_at timestamptz not null default now()
);

create trigger alert_state_touch before update on public.alert_state
  for each row execute function public.touch_updated_at();

-- ── events ──────────────────────────────────────────────────────────────────────────────────────────────────────

create table public.alert_events (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  -- account | market | cycle | event | occurrence: the same transition never makes a second row
  dedup_key   text not null check (char_length(dedup_key) between 1 and 200),
  source      text not null check (source in ('industry', 'whale', 'keylevel')),
  market_key  text not null check (char_length(market_key) between 1 and 80),
  market      text not null check (char_length(market) between 1 and 60),
  event       text not null check (event in ('green_warn', 'green_confirm', 'red_warn', 'red_confirm')),
  value       double precision,
  detail      text check (detail is null or char_length(detail) <= 300),
  -- 'cooldown': the engine held it back (kept for the log, no deliveries)
  suppressed  text check (suppressed is null or suppressed in ('cooldown')),
  occurred_at timestamptz not null,
  created_at  timestamptz not null default now(),
  unique (user_id, dedup_key)
);

create index alert_events_user_time on public.alert_events (user_id, occurred_at desc);

-- ── delivery log ────────────────────────────────────────────────────────────────────────────────────────────────

create table public.alert_deliveries (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references auth.users (id) on delete cascade,
  -- null for a test call / test mail and for the old e-mail summary of the key levels
  event_id     uuid references public.alert_events (id) on delete cascade,
  kind         text not null default 'alarm' check (kind in ('alarm', 'test')),
  channel      text not null check (channel in ('browser', 'email', 'phone')),
  status       text not null check (status in ('queued', 'sending', 'ringing', 'answered', 'sent', 'shown', 'failed', 'skipped', 'dead')),
  -- a code (`quiet_hours`, `busy`, `unclear` …), never text from a provider and never a number or address
  reason       text check (reason is null or char_length(reason) <= 40),
  attempts     integer not null default 0 check (attempts >= 0),
  -- Twilio CallSid / Resend id
  provider_ref text check (provider_ref is null or char_length(provider_ref) <= 80),
  -- planned time (an e-mail held over the quiet hours)
  not_before   timestamptz,
  -- phone: set in the SAME step that checks the budget, BEFORE the dial request – the proof that a call may already be on its way
  dialed_at    timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);

-- one delivery per (event, channel): the second insert is refused
create unique index alert_deliveries_event_channel on public.alert_deliveries (event_id, channel) where event_id is not null;
create index alert_deliveries_user_time on public.alert_deliveries (user_id, created_at desc);
create index alert_deliveries_ref on public.alert_deliveries (provider_ref) where provider_ref is not null;
create index alert_deliveries_phone_use on public.alert_deliveries (dialed_at) where channel = 'phone' and dialed_at is not null;

create trigger alert_deliveries_touch before update on public.alert_deliveries
  for each row execute function public.touch_updated_at();

-- ── jobs ────────────────────────────────────────────────────────────────────────────────────────────────────────

create table public.jobs (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('alert.deliver')),
  -- idempotency: the same work is queued once (`<event id>:<channel>`)
  job_key     text not null check (char_length(job_key) between 1 and 200),
  payload     jsonb not null default '{}'::jsonb check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 4096),
  status      text not null default 'queued' check (status in ('queued', 'leased', 'done', 'dead')),
  attempts    integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts between 1 and 20),
  run_at      timestamptz not null default now(),
  lease_until timestamptz,
  lease_token uuid,
  -- the last failure as a code
  last_code   text check (last_code is null or char_length(last_code) <= 40),
  finished_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (kind, job_key)
);

create index jobs_due on public.jobs (run_at) where status in ('queued', 'leased');
create index jobs_user_status on public.jobs (user_id, status);

create trigger jobs_touch before update on public.jobs
  for each row execute function public.touch_updated_at();

-- ── row level security ──────────────────────────────────────────────────────────────────────────────────────────

alter table public.alert_prefs enable row level security;
alter table public.alert_phones enable row level security;
alter table public.alert_phone_secrets enable row level security;
alter table public.alert_state enable row level security;
alter table public.alert_events enable row level security;
alter table public.alert_deliveries enable row level security;
alter table public.jobs enable row level security;

create policy "alert_prefs: read own" on public.alert_prefs for select to authenticated using ((select auth.uid()) = user_id);
create policy "alert_phones: read own" on public.alert_phones for select to authenticated using ((select auth.uid()) = user_id);
create policy "alert_events: read own" on public.alert_events for select to authenticated using ((select auth.uid()) = user_id);
create policy "alert_deliveries: read own" on public.alert_deliveries for select to authenticated using ((select auth.uid()) = user_id);
create policy "jobs: read own" on public.jobs for select to authenticated using ((select auth.uid()) = user_id);

-- 2FA accounts: aal2 (the rule of 0001 / 0005)
create policy "alert_prefs: mfa" on public.alert_prefs as restrictive for select to authenticated using (public.mfa_satisfied());
create policy "alert_phones: mfa" on public.alert_phones as restrictive for select to authenticated using (public.mfa_satisfied());
create policy "alert_events: mfa" on public.alert_events as restrictive for select to authenticated using (public.mfa_satisfied());
create policy "alert_deliveries: mfa" on public.alert_deliveries as restrictive for select to authenticated using (public.mfa_satisfied());
create policy "jobs: mfa" on public.jobs as restrictive for select to authenticated using (public.mfa_satisfied());

-- the client only reads; every write goes through a function with the service role
revoke all on public.alert_prefs, public.alert_phones, public.alert_phone_secrets, public.alert_state, public.alert_events, public.alert_deliveries, public.jobs from anon, authenticated;
grant select on public.alert_prefs, public.alert_phones, public.alert_events, public.alert_deliveries, public.jobs to authenticated;

-- ── functions (service role only) ───────────────────────────────────────────────────────────────────────────────

-- The accounts the engine looks at: at least one source on. `p_salt` rotates the order from run to run (fair when there are more than a run handles).
create or replace function public.alert_candidates(p_limit integer default 200, p_salt text default '')
returns table (user_id uuid, prefs jsonb, tz text)
language sql stable security definer set search_path = '' as $$
  select a.user_id, a.prefs, coalesce(p.tz, 'Europe/Berlin')
    from public.alert_prefs a
    left join public.profiles p on p.id = a.user_id
   where a.prefs -> 'sources' -> 'industry' ->> 'on' = 'true'
      or a.prefs -> 'sources' -> 'whale' ->> 'on' = 'true'
      or a.prefs -> 'sources' -> 'keylevel' ->> 'on' = 'true'
   order by md5(a.user_id::text || coalesce(p_salt, ''))
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;
revoke execute on function public.alert_candidates(integer, text) from public, anon, authenticated;
grant execute on function public.alert_candidates(integer, text) to service_role;

-- The user's own key levels (the settings document, key `keyLevels`), for the key-level source.
create or replace function public.alert_user_keylevels(p_user uuid)
returns jsonb
language sql stable security definer set search_path = '' as $$
  select d.data -> 'keyLevels'
    from public.journal_docs d
   where d.user_id = p_user and d.kind = 'settings' and d.id = 'settings' and not d.deleted;
$$;
revoke execute on function public.alert_user_keylevels(uuid) from public, anon, authenticated;
grant execute on function public.alert_user_keylevels(uuid) to service_role;

-- One event with its deliveries and jobs, or nothing: the event's unique key is the deduplication. Returns the new event id, or NULL when
-- the key exists already (a repeated run after a crash – nothing is created a second time).
-- p_deliveries: [{ "channel": "email", "status": "queued", "reason": null, "run_at": "2026-11-02T10:00:00Z" }, …]
create or replace function public.alert_enqueue(
  p_user uuid, p_dedup_key text, p_source text, p_market_key text, p_market text, p_event text,
  p_value double precision, p_detail text, p_suppressed text, p_occurred timestamptz, p_deliveries jsonb
) returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_event uuid;
  v_delivery uuid;
  d jsonb;
begin
  insert into public.alert_events (user_id, dedup_key, source, market_key, market, event, value, detail, suppressed, occurred_at)
  values (p_user, p_dedup_key, p_source, p_market_key, left(p_market, 60), p_event, p_value, left(p_detail, 300), p_suppressed, p_occurred)
  on conflict (user_id, dedup_key) do nothing
  returning id into v_event;
  if v_event is null then
    return null;
  end if;
  for d in select * from jsonb_array_elements(coalesce(p_deliveries, '[]'::jsonb)) loop
    insert into public.alert_deliveries (user_id, event_id, kind, channel, status, reason, not_before)
    values (p_user, v_event, 'alarm', d ->> 'channel', d ->> 'status', d ->> 'reason', (d ->> 'run_at')::timestamptz)
    returning id into v_delivery;
    if d ->> 'status' = 'queued' and d ->> 'channel' in ('email', 'phone') then
      insert into public.jobs (user_id, kind, job_key, payload, run_at)
      values (p_user, 'alert.deliver', v_event::text || ':' || (d ->> 'channel'), jsonb_build_object('delivery_id', v_delivery), coalesce((d ->> 'run_at')::timestamptz, now()))
      on conflict (kind, job_key) do nothing;
    end if;
  end loop;
  return v_event;
end $$;
revoke execute on function public.alert_enqueue(uuid, text, text, text, text, text, double precision, text, text, timestamptz, jsonb) from public, anon, authenticated;
grant execute on function public.alert_enqueue(uuid, text, text, text, text, text, double precision, text, text, timestamptz, jsonb) to service_role;

-- A test (test call, test mail) or a delivery the old e-mail summary made: a log row and, for the phone, a job – never an event.
create or replace function public.alert_enqueue_test(p_user uuid, p_channel text, p_job boolean)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_delivery uuid;
begin
  insert into public.alert_deliveries (user_id, event_id, kind, channel, status)
  values (p_user, null, 'test', p_channel, 'queued')
  returning id into v_delivery;
  if p_job then
    insert into public.jobs (user_id, kind, job_key, payload)
    values (p_user, 'alert.deliver', 'test:' || v_delivery::text, jsonb_build_object('delivery_id', v_delivery));
  end if;
  return v_delivery;
end $$;
revoke execute on function public.alert_enqueue_test(uuid, text, boolean) from public, anon, authenticated;
grant execute on function public.alert_enqueue_test(uuid, text, boolean) to service_role;

-- Takes up to p_limit due jobs: queued and due, or leased with an EXPIRED lease (a worker died). `attempts` counts every take, so a job that
-- keeps killing its worker ends in the dead letter instead of looping. FOR UPDATE SKIP LOCKED: two workers never get the same job.
-- p_user: only that account's jobs (the test call of the settings page delivers right away without touching anybody else's work).
create or replace function public.jobs_claim(p_kind text, p_limit integer, p_lease_sec integer, p_user uuid default null)
returns table (id uuid, user_id uuid, payload jsonb, attempts integer, max_attempts integer, lease_token uuid)
language sql volatile security definer set search_path = '' as $$
  with due as (
    select j.id
      from public.jobs j
     where j.kind = p_kind
       and (p_user is null or j.user_id = p_user)
       and ((j.status = 'queued' and j.run_at <= now()) or (j.status = 'leased' and j.lease_until < now()))
     order by j.run_at
     limit least(greatest(coalesce(p_limit, 10), 1), 50)
       for update skip locked
  )
  update public.jobs j
     set status = 'leased',
         attempts = j.attempts + 1,
         lease_until = now() + make_interval(secs => least(greatest(coalesce(p_lease_sec, 90), 10), 900)),
         lease_token = gen_random_uuid()
    from due
   where j.id = due.id
  returning j.id, j.user_id, j.payload, j.attempts, j.max_attempts, j.lease_token;
$$;
revoke execute on function public.jobs_claim(text, integer, integer, uuid) from public, anon, authenticated;
grant execute on function public.jobs_claim(text, integer, integer, uuid) to service_role;

-- Finishes a job as 'done' or 'dead' – only with the current lease token (a worker that lost its lease changes nothing).
create or replace function public.jobs_complete(p_id uuid, p_token uuid, p_status text, p_code text)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer;
begin
  if p_status not in ('done', 'dead') then
    return false;
  end if;
  update public.jobs
     set status = p_status, last_code = left(p_code, 40), finished_at = now(), lease_until = null, lease_token = null
   where id = p_id and lease_token = p_token and status = 'leased';
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke execute on function public.jobs_complete(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.jobs_complete(uuid, uuid, text, text) to service_role;

-- Puts a job back for later (back-off), fenced by the lease token.
create or replace function public.jobs_retry(p_id uuid, p_token uuid, p_delay_sec integer, p_code text)
returns boolean
language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.jobs
     set status = 'queued', run_at = now() + make_interval(secs => least(greatest(coalesce(p_delay_sec, 60), 1), 86400)),
         last_code = left(p_code, 40), lease_until = null, lease_token = null
   where id = p_id and lease_token = p_token and status = 'leased';
  get diagnostics n = row_count;
  return n = 1;
end $$;
revoke execute on function public.jobs_retry(uuid, uuid, integer, text) from public, anon, authenticated;
grant execute on function public.jobs_retry(uuid, uuid, integer, text) to service_role;

-- A call is COMMITTED before it is dialed: the budget (plan month, the account's day, the server's day – the order of `phoneBudget` in
-- src/domain/alerts/delivery.ts) and `dialed_at` are decided in one locked step. Returns 'ok' (go and dial), 'already' (a call may already be
-- on its way – never dial again), 'phone_opted_out', or the reason of the limit (the delivery is then 'skipped'). Month and day are UTC.
create or replace function public.alert_phone_reserve(p_delivery uuid, p_user uuid, p_month_limit integer, p_user_day_max integer, p_global_day_max integer)
returns text
language plpgsql volatile security definer set search_path = '' as $$
declare
  d public.alert_deliveries%rowtype;
  v_month integer;
  v_user_day integer;
  v_global_day integer;
  v_reason text;
begin
  perform pg_advisory_xact_lock(hashtext('alert_phone_budget'));
  select * into d from public.alert_deliveries where id = p_delivery and user_id = p_user and channel = 'phone' for update;
  if not found then
    return 'already';
  end if;
  if d.dialed_at is not null or d.status not in ('queued', 'sending') then
    return 'already';
  end if;
  if not exists (select 1 from public.alert_phones where user_id = p_user and status = 'verified')
     or not exists (select 1 from public.alert_phone_secrets where user_id = p_user and verified) then
    update public.alert_deliveries set status = 'skipped', reason = 'phone_opted_out' where id = p_delivery;
    return 'phone_opted_out';
  end if;
  select count(*) into v_month from public.alert_deliveries
   where user_id = p_user and channel = 'phone' and dialed_at >= date_trunc('month', now() at time zone 'utc') at time zone 'utc';
  select count(*) into v_user_day from public.alert_deliveries
   where user_id = p_user and channel = 'phone' and dialed_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  select count(*) into v_global_day from public.alert_deliveries
   where channel = 'phone' and dialed_at >= date_trunc('day', now() at time zone 'utc') at time zone 'utc';
  v_reason := case
    when not (coalesce(p_month_limit, 0) > 0) then 'no_plan'
    when v_month >= p_month_limit then 'month_limit'
    when v_user_day >= p_user_day_max then 'user_day_limit'
    when v_global_day >= p_global_day_max then 'global_day_limit'
    else null
  end;
  if v_reason is not null then
    update public.alert_deliveries set status = 'skipped', reason = v_reason where id = p_delivery;
    return v_reason;
  end if;
  update public.alert_deliveries set status = 'sending', dialed_at = now(), attempts = attempts + 1, reason = null where id = p_delivery;
  return 'ok';
end $$;
revoke execute on function public.alert_phone_reserve(uuid, uuid, integer, integer, integer) from public, anon, authenticated;
grant execute on function public.alert_phone_reserve(uuid, uuid, integer, integer, integer) to service_role;

-- A status callback (or a poll) of a call: moves it forward only (queued → ringing → answered / failed); a late or repeated callback changes nothing.
-- Returns the delivery id when something changed.
create or replace function public.alert_delivery_advance(p_ref text, p_status text, p_reason text)
returns uuid
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_id uuid;
begin
  update public.alert_deliveries d
     set status = p_status, reason = left(p_reason, 40)
   where d.provider_ref = p_ref and d.channel = 'phone'
     and d.status in ('queued', 'sending', 'ringing')
     and p_status in ('queued', 'ringing', 'answered', 'failed')
     and (case d.status when 'queued' then 1 when 'sending' then 2 else 3 end) < (case p_status when 'queued' then 1 when 'ringing' then 3 else 4 end)
  returning d.id into v_id;
  return v_id;
end $$;
revoke execute on function public.alert_delivery_advance(text, text, text) from public, anon, authenticated;
grant execute on function public.alert_delivery_advance(text, text, text) to service_role;

-- Opt-out, at once and in one step: the number is deleted, the status is 'revoked', and every call that has not been dialed yet is cancelled.
create or replace function public.alert_phone_revoke(p_user uuid)
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  n integer;
begin
  update public.alert_phones set status = 'revoked', revoked_at = now() where user_id = p_user and status <> 'revoked';
  delete from public.alert_phone_secrets where user_id = p_user;
  update public.alert_deliveries set status = 'skipped', reason = 'phone_opted_out'
   where user_id = p_user and channel = 'phone' and dialed_at is null and status = 'queued';
  get diagnostics n = row_count;
  update public.jobs j set status = 'done', last_code = 'phone_opted_out', finished_at = now(), lease_until = null, lease_token = null
   where j.user_id = p_user and j.kind = 'alert.deliver' and j.status in ('queued', 'leased')
     and exists (select 1 from public.alert_deliveries d where d.id = (j.payload ->> 'delivery_id')::uuid and d.channel = 'phone' and d.dialed_at is null);
  return n;
end $$;
revoke execute on function public.alert_phone_revoke(uuid) from public, anon, authenticated;
grant execute on function public.alert_phone_revoke(uuid) to service_role;

-- Housekeeping (the cron calls it once a day): old events (and their deliveries) after 90 days, finished jobs after 30.
create or replace function public.alert_prune()
returns integer
language plpgsql volatile security definer set search_path = '' as $$
declare
  a integer;
  b integer;
begin
  delete from public.alert_events where created_at < now() - interval '90 days';
  get diagnostics a = row_count;
  delete from public.alert_deliveries where event_id is null and created_at < now() - interval '90 days';
  delete from public.jobs where status in ('done', 'dead') and finished_at < now() - interval '30 days';
  get diagnostics b = row_count;
  return a + b;
end $$;
revoke execute on function public.alert_prune() from public, anon, authenticated;
grant execute on function public.alert_prune() to service_role;
