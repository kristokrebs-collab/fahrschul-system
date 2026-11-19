-- 0008_alert_watch.sql – E-Mail-Alarm bei geschlossener App (F21).
--
-- The scheduled function `alert-watch-cron` (every 5 minutes) watches the key-level alerts of accounts that switched on
-- "E-Mail-Alarm bei geschlossener App" (`settings.serverAlerts.email = true`, synced like every other setting). It reads
-- ONLY what it needs from the settings row – `data.keyLevels` (the rules), `data.serverAlerts` (the switch and its own
-- state) and the profile's time zone – and writes ONLY `data.serverAlerts` back (what already fired, so that every
-- trigger is mailed exactly once). Both calls are service-role functions; nothing here is reachable by a client.
--
--   alert_watch_candidates(p_limit, p_salt, p_user)  the accounts to look at: switch on, row not deleted. `p_salt` rotates the
--                                                    order from run to run (fair when more accounts exist than a run handles);
--                                                    `p_user` re-reads one account (after a lost race).
--   set_server_alerts(p_user, p_expected_rev, p_value)
--                                                    replaces `data.serverAlerts` of the settings row if its `rev` is still the
--                                                    one that was read (the optimistic lock of the sync, 0001); returns the new
--                                                    `rev`, or NULL when somebody wrote first (the cron then reads again).
--
-- The partial expression index keeps the 5-minute scan cheap: only rows whose switch is on are visited, the (possibly
-- large) settings documents of everybody else are never read.

create index if not exists journal_docs_alert_email
  on public.journal_docs ((data -> 'serverAlerts' ->> 'email'))
  where kind = 'settings' and id = 'settings';

create or replace function public.alert_watch_candidates(p_limit integer default 200, p_salt text default '', p_user uuid default null)
returns table (user_id uuid, rev bigint, key_levels jsonb, server_alerts jsonb, tz text)
language sql stable security definer set search_path = '' as $$
  select d.user_id, d.rev, d.data -> 'keyLevels', d.data -> 'serverAlerts', coalesce(p.tz, 'Europe/Berlin')
    from public.journal_docs d
    left join public.profiles p on p.id = d.user_id
   where d.kind = 'settings' and d.id = 'settings' and not d.deleted
     and d.data -> 'serverAlerts' ->> 'email' = 'true'
     and (p_user is null or d.user_id = p_user)
   order by md5(d.user_id::text || coalesce(p_salt, ''))
   limit least(greatest(coalesce(p_limit, 200), 1), 500);
$$;
revoke execute on function public.alert_watch_candidates(integer, text, uuid) from public, anon, authenticated;
grant execute on function public.alert_watch_candidates(integer, text, uuid) to service_role;

create or replace function public.set_server_alerts(p_user uuid, p_expected_rev bigint, p_value jsonb)
returns bigint
language plpgsql volatile security definer set search_path = '' as $$
declare
  v_rev bigint;
begin
  if p_user is null or p_expected_rev is null or p_value is null or jsonb_typeof(p_value) <> 'object' then
    return null;
  end if;
  update public.journal_docs
     set data = jsonb_set(data, '{serverAlerts}', p_value, true)
   where user_id = p_user and kind = 'settings' and id = 'settings' and not deleted
     and jsonb_typeof(data) = 'object' and rev = p_expected_rev
  returning rev into v_rev;
  return v_rev;
end $$;
revoke execute on function public.set_server_alerts(uuid, bigint, jsonb) from public, anon, authenticated;
grant execute on function public.set_server_alerts(uuid, bigint, jsonb) to service_role;
