-- 0010_cases.sql – Chartfälle mit Hypothese vorab (F47).
--
-- Run after 0004_social (groups, is_group_member) and 0005_mfa_everywhere (mfa_satisfied). A case is a stretch of PUBLIC
-- market data (symbol, candle size, the last candle everybody sees, how many candles ahead the question reaches) and a
-- question. Members write ONE hypothesis each; nobody sees the others' before the case is closed, nobody can change what
-- they wrote, and the outcome is not stored at all – every reader works it out from the public candles.
--
-- - RLS on both tables; clients read, all writes run through the functions (service role: rate limits, plan gate, rules).
-- - A hypothesis is visible to its author at once, to the group only after the case is closed (`closed_at` set or
--   `closes_at` passed). In mentor groups a student sees the mentors' hypotheses and their own – never another student's
--   (the same rule as `can_see_review`); owners and mentors see all of them.
-- - Written once: a trigger refuses every UPDATE (also from the service role) and every INSERT after the case closed,
--   and stamps `created_at` with the database clock – so the time on a hypothesis is the proof that it came first.
-- - Leaving a group or deleting an account removes the hypotheses and cases of the person (cascade / the function).
-- - Reports may name a case (`feedback.target_type = 'case'`).

create table public.group_cases (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  author_id  uuid not null references auth.users (id) on delete cascade,
  -- a USDⓈ-M symbol of the exchange ("BTCUSDT"); the candles are public
  pair       text not null check (pair ~ '^[A-Z0-9]{4,20}$'),
  interval   text not null check (interval in ('15m', '1h', '4h', '1d')),
  -- open time (ms, UTC) of the last candle that is shown
  anchor_ms  bigint not null check (anchor_ms between 1577836800000 and 4102444800000),
  -- candles ahead the question reaches
  horizon    smallint not null check (horizon in (6, 12, 24, 48)),
  question   text not null default '' check (char_length(question) <= 280),
  -- hypotheses are taken until then; the author (or an owner / mentor) may close earlier
  closes_at  timestamptz not null,
  closed_at  timestamptz,
  created_at timestamptz not null default now(),
  check (closes_at <= created_at + interval '8 days'),
  check (closed_at is null or closed_at >= created_at)
);
create index group_cases_group on public.group_cases (group_id, created_at desc);
create index group_cases_author on public.group_cases (author_id);

create table public.case_hypotheses (
  case_id    uuid not null references public.group_cases (id) on delete cascade,
  user_id    uuid not null references auth.users (id) on delete cascade,
  direction  text not null check (direction in ('up', 'down', 'flat')),
  confidence smallint not null check (confidence in (50, 60, 70, 80, 90)),
  reason     text not null check (char_length(btrim(reason)) between 10 and 280),
  created_at timestamptz not null default now(),
  primary key (case_id, user_id)
);
create index case_hypotheses_user on public.case_hypotheses (user_id);

-- ── written once, stamped by the database ────────────────────────────────────────────────────────────────────────

create function public.case_hypothesis_guard() returns trigger
language plpgsql set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    raise exception 'a hypothesis is written once' using errcode = '23001';
  end if;
  if exists (select 1 from public.group_cases c where c.id = new.case_id and (c.closed_at is not null or c.closes_at <= now())) then
    raise exception 'the case is closed' using errcode = '23514';
  end if;
  new.created_at := now();
  return new;
end;
$$;

create trigger case_hypothesis_write_once before insert or update on public.case_hypotheses
  for each row execute function public.case_hypothesis_guard();

-- ── visibility helpers (security definer: no policy recursion) ───────────────────────────────────────────────────

-- the caller is in the group of the case and the case is closed (no more hypotheses, all of them may be read)
create function public.can_see_hypothesis(p_case uuid, p_author uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_cases c
    join public.groups g on g.id = c.group_id
    join public.group_members m on m.group_id = c.group_id and m.user_id = auth.uid()
    join public.group_members a on a.group_id = c.group_id and a.user_id = p_author
    where c.id = p_case
      and (
        p_author = auth.uid()
        or (
          (c.closed_at is not null or c.closes_at <= now())
          and (g.kind <> 'mentor' or m.role in ('owner', 'mentor') or a.role in ('owner', 'mentor'))
        )
      )
  );
$$;
revoke execute on function public.can_see_hypothesis(uuid, uuid) from public, anon;
grant execute on function public.can_see_hypothesis(uuid, uuid) to authenticated, service_role;

-- ── RLS ──────────────────────────────────────────────────────────────────────────────────────────────────────────

alter table public.group_cases enable row level security;
create policy "group_cases: read as member" on public.group_cases
  for select to authenticated using (public.is_group_member(group_id));
create policy "group_cases: mfa" on public.group_cases as restrictive
  for select to authenticated using (public.mfa_satisfied());
revoke all on public.group_cases from anon, authenticated;
grant select on public.group_cases to authenticated;

alter table public.case_hypotheses enable row level security;
create policy "case_hypotheses: read visible" on public.case_hypotheses
  for select to authenticated using (public.can_see_hypothesis(case_id, user_id));
create policy "case_hypotheses: mfa" on public.case_hypotheses as restrictive
  for select to authenticated using (public.mfa_satisfied());
revoke all on public.case_hypotheses from anon, authenticated;
grant select on public.case_hypotheses to authenticated;

-- ── reports may name a case ──────────────────────────────────────────────────────────────────────────────────────

alter table public.feedback drop constraint if exists feedback_target_type_check;
alter table public.feedback add constraint feedback_target_type_check
  check (target_type is null or target_type in ('comment', 'review', 'share', 'group', 'case'));
