-- Checks of 0014_alerts.sql against a SCRATCH database (never production): run the migrations up to 0014, then
--   psql -v ON_ERROR_STOP=1 -f supabase/tests/0014_alerts.test.sql
-- Every check is an `assert`; a failure stops the script with its message. The script cleans up after itself (the rows it makes
-- belong to two throw-away users). Needs the roles of a Supabase database (authenticated, service_role).

begin;

insert into auth.users (id) values ('00000000-0000-4000-8000-0000000000a1'), ('00000000-0000-4000-8000-0000000000b2');

-- ── events: the unique dedupe key is the deduplication; event, deliveries and jobs are made together ─────────────
do $$
declare
  u constant uuid := '00000000-0000-4000-8000-0000000000a1';
  e1 uuid;
  e2 uuid;
  deliveries jsonb := '[{"channel":"email","status":"queued","reason":null,"run_at":"2026-11-02T10:00:00Z"},
                        {"channel":"phone","status":"queued","reason":null,"run_at":"2026-11-02T10:00:00Z"},
                        {"channel":"browser","status":"skipped","reason":"quiet_hours","run_at":"2026-11-02T10:00:00Z"}]';
begin
  e1 := public.alert_enqueue(u, 'u|industry:Chips|c2|green_confirm|n1', 'industry', 'industry:Chips', 'Elektronik und Chips', 'green_confirm', null, 'Datenstand', null, '2026-11-02T10:00:00Z', deliveries);
  assert e1 is not null, 'first enqueue creates the event';
  assert (select count(*) from public.alert_deliveries where event_id = e1) = 3, 'one delivery per channel';
  assert (select count(*) from public.jobs where user_id = u) = 2, 'a job for e-mail and phone, none for browser / skipped';
  e2 := public.alert_enqueue(u, 'u|industry:Chips|c2|green_confirm|n1', 'industry', 'industry:Chips', 'Elektronik und Chips', 'green_confirm', null, 'Datenstand', null, '2026-11-02T10:00:00Z', deliveries);
  assert e2 is null, 'the same dedupe key makes nothing a second time';
  assert (select count(*) from public.alert_events where user_id = u) = 1, 'still one event';
  assert (select count(*) from public.alert_deliveries where user_id = u) = 3, 'still three deliveries';
  assert (select count(*) from public.jobs where user_id = u) = 2, 'still two jobs';
  assert (select status from public.alert_deliveries where event_id = e1 and channel = 'browser') = 'skipped', 'the skipped reason is kept';
  -- a suppressed event is a row without deliveries
  assert public.alert_enqueue(u, 'u|industry:Chips|c2|green_warn|n2', 'industry', 'industry:Chips', 'Chips', 'green_warn', 1.5, null, 'cooldown', now(), '[]') is not null;
  assert (select count(*) from public.alert_deliveries where user_id = u) = 3, 'a suppressed event has no deliveries';
end $$;

-- ── jobs: lease, takeover after a crash, fencing ────────────────────────────────────────────────────────────────
do $$
declare
  u constant uuid := '00000000-0000-4000-8000-0000000000a1';
  j record;
  j2 record;
  ok boolean;
begin
  update public.jobs set run_at = now() - interval '1 minute' where user_id = u;
  assert (select count(*) from public.jobs_claim('alert.deliver', 1, 90)) = 1, 'claims one job (limit 1)';
  assert (select count(*) from public.jobs_claim('alert.deliver', 10, 90)) = 1, 'the other job; the leased one is not given again';
  assert (select count(*) from public.jobs_claim('alert.deliver', 10, 90)) = 0, 'nothing due while both leases hold';
  update public.jobs set status = 'queued', lease_until = null, lease_token = null where user_id = u;
  assert (select count(*) from public.jobs_claim('alert.deliver', 10, 90, '00000000-0000-4000-8000-0000000000b2')) = 0, 'p_user: only that account''s jobs';
  assert (select count(*) from public.jobs_claim('alert.deliver', 10, 90, u)) = 2, 'p_user: the account''s own jobs';

  -- a worker dies: its lease expires, the job is taken again with attempts 2
  update public.jobs set lease_until = now() - interval '1 second', attempts = 1 where user_id = u and status = 'leased';
  select * into j from public.jobs_claim('alert.deliver', 1, 90);
  assert j.id is not null and j.attempts = 2, 'an expired lease is taken over, attempts counts the take';
  -- the dead worker comes back with its OLD token: it changes nothing
  select * into j2 from public.jobs where id = j.id;
  ok := public.jobs_complete(j.id, '00000000-0000-4000-8000-000000000999', 'done', null);
  assert ok = false, 'a wrong lease token completes nothing';
  ok := public.jobs_retry(j.id, '00000000-0000-4000-8000-000000000999', 60, 'x');
  assert ok = false, 'a wrong lease token retries nothing';
  assert (select status from public.jobs where id = j.id) = 'leased', 'still leased';
  update public.jobs set status = 'done', lease_until = null, lease_token = null where user_id = u and id <> j.id; -- the other job is out of the way
  ok := public.jobs_retry(j.id, j.lease_token, 3600, 'resend_5xx');
  assert ok, 'the holder can put it back with a back-off';
  assert (select status from public.jobs where id = j.id) = 'queued' and (select run_at from public.jobs where id = j.id) > now() + interval '59 minutes', 'queued again, one hour later';
  assert (select last_code from public.jobs where id = j.id) = 'resend_5xx', 'the code is kept';
  update public.jobs set run_at = now() - interval '1 second' where id = j.id;
  select * into j from public.jobs_claim('alert.deliver', 1, 90);
  assert j.attempts = 3, 'third take';
  assert public.jobs_complete(j.id, j.lease_token, 'dead', 'retries_used_up'), 'dead letter';
  assert (select status from public.jobs where id = j.id) = 'dead' and (select finished_at from public.jobs where id = j.id) is not null, 'dead with a finish time';
  assert public.jobs_complete(j.id, j.lease_token, 'done', null) = false, 'a finished job is not changed again';
  assert public.jobs_complete(j.id, j.lease_token, 'weird', null) = false, 'only done / dead';
end $$;

-- ── phone: the budget and "committed before dialed" ─────────────────────────────────────────────────────────────
do $$
declare
  u constant uuid := '00000000-0000-4000-8000-0000000000b2';
  d1 uuid;
  d2 uuid;
  d3 uuid;
  r text;
begin
  insert into public.alert_phones (user_id, status, masked, consent_at, consent_version, verified_at) values (u, 'verified', '+49 ••• ••67', now(), 'v1', now());
  insert into public.alert_phone_secrets (user_id, number_enc, number_hash, verified) values (u, 'v1:x:y:z', repeat('a', 64), true);
  d1 := public.alert_enqueue_test(u, 'phone', true);
  d2 := public.alert_enqueue_test(u, 'phone', true);
  d3 := public.alert_enqueue_test(u, 'phone', true);

  r := public.alert_phone_reserve(d1, u, 2, 5, 100);
  assert r = 'ok', 'the first call is reserved: ' || r;
  assert (select status from public.alert_deliveries where id = d1) = 'sending' and (select dialed_at from public.alert_deliveries where id = d1) is not null, 'sending, dialed_at set BEFORE the dial';
  assert public.alert_phone_reserve(d1, u, 2, 5, 100) = 'already', 'a second reserve of the same delivery says already – never dial twice';
  assert public.alert_phone_reserve(d2, u, 2, 5, 100) = 'ok', 'second call of the month';
  r := public.alert_phone_reserve(d3, u, 2, 5, 100);
  assert r = 'month_limit', 'the third is over the monthly limit: ' || r;
  assert (select status from public.alert_deliveries where id = d3) = 'skipped' and (select reason from public.alert_deliveries where id = d3) = 'month_limit', 'skipped with the reason';
  assert (select dialed_at from public.alert_deliveries where id = d3) is null, 'never dialed';

  d3 := public.alert_enqueue_test(u, 'phone', true);
  assert public.alert_phone_reserve(d3, u, 30, 2, 100) = 'user_day_limit', 'the account''s day';
  d3 := public.alert_enqueue_test(u, 'phone', true);
  assert public.alert_phone_reserve(d3, u, 30, 5, 2) = 'global_day_limit', 'the server''s day (cost brake)';
  d3 := public.alert_enqueue_test(u, 'phone', true);
  assert public.alert_phone_reserve(d3, u, 0, 5, 100) = 'no_plan', 'a plan without calls';

  -- status callbacks move forward only
  update public.alert_deliveries set provider_ref = 'CA111' where id = d1;
  update public.alert_deliveries set provider_ref = 'CA222' where id = d2;
  assert public.alert_delivery_advance('CA111', 'ringing', null) = d1, 'sending → ringing';
  assert public.alert_delivery_advance('CA111', 'queued', null) is null, 'ringing never goes back to queued';
  assert public.alert_delivery_advance('CA111', 'answered', null) = d1, 'ringing → answered';
  assert public.alert_delivery_advance('CA111', 'failed', 'no_answer') is null, 'answered never becomes failed';
  assert public.alert_delivery_advance('CA222', 'failed', 'busy') = d2, 'sending → failed (busy)';
  assert (select reason from public.alert_deliveries where id = d2) = 'busy', 'reason kept';
  assert public.alert_delivery_advance('CA999', 'ringing', null) is null, 'unknown call id changes nothing';

  -- opt-out: the number is gone, undialed calls are cancelled, their jobs are closed
  d3 := public.alert_enqueue_test(u, 'phone', true);
  perform public.alert_phone_revoke(u);
  assert (select status from public.alert_phones where user_id = u) = 'revoked', 'revoked';
  assert not exists (select 1 from public.alert_phone_secrets where user_id = u), 'the number is deleted';
  assert (select status from public.alert_deliveries where id = d3) = 'skipped' and (select reason from public.alert_deliveries where id = d3) = 'phone_opted_out', 'an undialed call is cancelled';
  assert not exists (select 1 from public.jobs j where j.user_id = u and j.status in ('queued', 'leased') and (j.payload ->> 'delivery_id')::uuid = d3), 'its job is closed';
  d3 := public.alert_enqueue_test(u, 'phone', true);
  assert public.alert_phone_reserve(d3, u, 30, 5, 100) = 'phone_opted_out', 'no call after the opt-out, even if a job is left';
end $$;

-- ── one verified number per number: a second account cannot verify the same one ─────────────────────────────────
do $$
begin
  insert into public.alert_phone_secrets (user_id, number_enc, number_hash, verified) values ('00000000-0000-4000-8000-0000000000a1', 'v1:x:y:z', repeat('c', 64), true);
  begin
    insert into public.alert_phone_secrets (user_id, number_enc, number_hash, verified) values ('00000000-0000-4000-8000-0000000000b2', 'v1:x:y:z', repeat('c', 64), true);
    assert false, 'the same verified number twice must be refused';
  exception when unique_violation then null;
  end;
end $$;

-- ── candidates and key levels ───────────────────────────────────────────────────────────────────────────────────
do $$
declare
  u constant uuid := '00000000-0000-4000-8000-0000000000a1';
begin
  insert into public.profiles (id, tz) values (u, 'America/New_York');
  insert into public.alert_prefs (user_id, prefs) values (u, '{"sources":{"industry":{"on":true},"whale":{"on":false},"keylevel":{"on":false}}}');
  insert into public.alert_prefs (user_id, prefs) values ('00000000-0000-4000-8000-0000000000b2', '{"sources":{"industry":{"on":false}}}');
  assert (select count(*) from public.alert_candidates(10, 's')) = 1, 'only accounts with a source on';
  assert (select tz from public.alert_candidates(10, 's')) = 'America/New_York', 'with their zone';
  insert into public.journal_docs (user_id, kind, id, data) values (u, 'settings', 'settings', '{"keyLevels":{"v":1,"levels":[]}}');
  assert public.alert_user_keylevels(u) = '{"v":1,"levels":[]}'::jsonb, 'the key levels of the settings document';
end $$;

-- ── row level security: the client reads its own rows and nothing else; secrets and memory are closed ────────────
do $$
declare
  n integer;
begin
  set local role authenticated;
  perform set_config('request.jwt.claim.sub', '00000000-0000-4000-8000-0000000000a1', true);
  select count(*) into n from public.alert_events;
  assert n = 2, 'own events only';
  select count(*) into n from public.alert_deliveries;
  assert n = 3, 'own deliveries only (the other account has more)';
  select count(*) into n from public.jobs;
  assert n = 2, 'own jobs only';
  select count(*) into n from public.alert_prefs;
  assert n = 1, 'own prefs only';
  begin
    perform 1 from public.alert_phone_secrets;
    assert false, 'secrets must not be readable';
  exception when insufficient_privilege then null;
  end;
  begin
    perform 1 from public.alert_state;
    assert false, 'engine memory must not be readable';
  exception when insufficient_privilege then null;
  end;
  begin
    insert into public.alert_prefs (user_id, prefs) values ('00000000-0000-4000-8000-0000000000a1', '{}');
    assert false, 'the client must not write prefs';
  exception when insufficient_privilege then null;
  end;
  begin
    perform public.alert_enqueue('00000000-0000-4000-8000-0000000000a1', 'x', 'industry', 'k', 'm', 'green_warn', null, null, null, now(), '[]');
    assert false, 'the client must not call the functions';
  exception when insufficient_privilege then null;
  end;
  reset role;
end $$;

rollback;
