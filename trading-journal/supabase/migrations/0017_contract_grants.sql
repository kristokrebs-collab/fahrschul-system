-- 0017 – grant correction to 0016: the browser reads no hash of a contract request
--
-- Found by the isolation audit (tests/unit/supabase.audit.test.ts, R2b): 0016 granted `select` on the whole of
-- `public.contract_requests` to `authenticated`, including `email_hash` (salted SHA-256 of the address) and `token_hash`
-- (SHA-256 of the confirmation-link token). Rows are only visible to their own user (RLS, unchanged), and the token is random,
-- but no client code reads this table at all (cancel / withdraw run in the function `billing-contract`), and a hash of an
-- address or a link token is nothing a browser needs – so the right is narrowed to the columns an account could ever show.
-- Nothing else changes: policies, `consents` and every write path stay as they were.
revoke select on public.contract_requests from authenticated;
grant select (id, kind, user_id, declared_name, contract_hint, status, received_at, executed_at, ends_at) on public.contract_requests to authenticated;
