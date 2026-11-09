-- 0005_mfa_everywhere.sql – the aal2 rule on every client-readable table and on the screenshots bucket (review SEC-01).
--
-- Run after 0004_social.sql. 0001 – 0004 required an aal2 session (TOTP verified) only for journal_docs,
-- exchange_connections, sync_runs and the community tables groups / group_members / group_reviews / comments. A
-- password-only (aal1) session of a user WITH a verified factor could still read the chart screenshots (and create
-- signed URLs for them), write into the screenshots folder, and read the audit trail, the share tokens, the API token
-- list, the billing rows, the invites, goals, stats and pseudonyms. This migration closes that: as soon as a user has
-- a verified factor, everything below needs aal2 – the same `public.mfa_satisfied()` as in 0001.
--
-- Deliberately NOT restricted: `profiles` (the client reads its privacy opt-ins right after the password step to
-- decide what to sync; plan / display name / time zone are not secret) and `community_stats` (k-anonymous aggregates
-- of n >= 10, readable by every signed-in user).
--
-- The Netlify functions (service role, RLS bypassed) apply the same rule in code: `requireUser(req, { aal2:
-- "ifEnrolled" })` for every endpoint that returns or changes account data (billing portal / checkout / referral,
-- audit trail, coach AI); `billing/status` answers an unverified 2FA session like a signed-out visitor.

-- ── tables: restrictive policies (AND-ed with the existing "read own" policies) ─────────────────────────────────

create policy "audit_log: mfa" on public.audit_log as restrictive
  for select to authenticated using (public.mfa_satisfied());

create policy "subscriptions: mfa" on public.subscriptions as restrictive
  for select to authenticated using (public.mfa_satisfied());
create policy "team_seats: mfa" on public.team_seats as restrictive
  for select to authenticated using (public.mfa_satisfied());
create policy "referral_codes: mfa" on public.referral_codes as restrictive
  for select to authenticated using (public.mfa_satisfied());
create policy "referrals: mfa" on public.referrals as restrictive
  for select to authenticated using (public.mfa_satisfied());
create policy "affiliate_ledger: mfa" on public.affiliate_ledger as restrictive
  for select to authenticated using (public.mfa_satisfied());

create policy "api_tokens: mfa" on public.api_tokens as restrictive
  for select to authenticated using (public.mfa_satisfied());

create policy "social_profiles: mfa" on public.social_profiles as restrictive
  for select to authenticated using (public.mfa_satisfied());
create policy "group_invites: mfa" on public.group_invites as restrictive
  for select to authenticated using (public.mfa_satisfied());
create policy "group_goals: mfa" on public.group_goals as restrictive
  for select to authenticated using (public.mfa_satisfied());
create policy "shares: mfa" on public.shares as restrictive
  for select to authenticated using (public.mfa_satisfied());
create policy "feedback: mfa" on public.feedback as restrictive
  for select to authenticated using (public.mfa_satisfied());
create policy "member_stats: mfa" on public.member_stats as restrictive
  for select to authenticated using (public.mfa_satisfied());

-- ── storage: the screenshots bucket ─────────────────────────────────────────────────────────────────────────────
-- The four own-folder policies of 0001 are replaced by the same policies plus `mfa_satisfied()` (select also gates
-- `createSignedUrl`, which reads the object row as the caller). Skipped where the storage schema does not exist.

do $$
begin
  if exists (select 1 from information_schema.tables where table_schema = 'storage' and table_name = 'objects') then
    execute 'drop policy if exists "screenshots: read own" on storage.objects';
    execute 'drop policy if exists "screenshots: insert own" on storage.objects';
    execute 'drop policy if exists "screenshots: update own" on storage.objects';
    execute 'drop policy if exists "screenshots: delete own" on storage.objects';
    execute $p$create policy "screenshots: read own" on storage.objects for select to authenticated
      using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
             and public.mfa_satisfied())$p$;
    execute $p$create policy "screenshots: insert own" on storage.objects for insert to authenticated
      with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
                  and public.mfa_satisfied())$p$;
    execute $p$create policy "screenshots: update own" on storage.objects for update to authenticated
      using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
             and public.mfa_satisfied())
      with check (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
                  and public.mfa_satisfied())$p$;
    execute $p$create policy "screenshots: delete own" on storage.objects for delete to authenticated
      using (bucket_id = 'screenshots' and (storage.foldername(name))[1] = (select auth.uid())::text
             and public.mfa_satisfied())$p$;
  end if;
end $$;
