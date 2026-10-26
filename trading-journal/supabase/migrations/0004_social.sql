-- 0004_social.sql – community: groups, mentors, teams, shares, reviews, comments, feedback, leaderboards (owner P12).
--
-- Run after 0001_core, 0002_billing (team_seats) and 0003_exchange. Privacy first:
-- - Everything is OPT-IN. Nobody appears in a ranking unless `profiles.privacy.leaderboard = true`; nobody's numbers
--   are visible to a group unless their membership says `share_level = 'stats'`; a trade only leaves the journal when its
--   owner posts or shares it.
-- - Shared content is R-based and redacted by the functions (netlify/functions/_lib/social, src/social/redact.ts): no
--   money amounts, no account size, no notes. People appear under a generated pseudonym ("Stiller Falke 27"), never
--   under their e-mail or display name.
-- - Aggregates are k-anonymous: `community_stats` refuses rows with fewer than 10 traders (check constraint), the
--   functions apply the same k to group averages.
-- - RLS on EVERY table, client policies via membership (security definer helpers below, no policy recursion). All
--   writes run through the functions (service role) so rate limits, redaction, mentions and seat rules hold; clients
--   get read access to what their membership allows and nothing else.
-- - Account deletion cascades everything of the user (groups they own with all content, memberships, reviews,
--   comments, shares, stats, snapshots, feedback). Leaving a group removes the leaver's reviews in that group.

-- ── groups + group_members, membership helpers ──────────────────────────────────────────────────────────────────
-- The helpers are security definer: they read memberships without re-entering the RLS of group_members.

create table public.groups (
  id          uuid primary key default gen_random_uuid(),
  -- group: peers · mentor: one mentor (owner) + students · team: owner's Team plan, every member takes a seat
  kind        text not null default 'group' check (kind in ('group', 'mentor', 'team')),
  name        text not null check (char_length(btrim(name)) between 2 and 40),
  description text not null default '' check (char_length(description) <= 280),
  owner_id    uuid not null references auth.users (id) on delete cascade,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index groups_owner on public.groups (owner_id);

create trigger groups_touch before update on public.groups
  for each row execute function public.touch_updated_at();

create table public.group_members (
  group_id    uuid not null references public.groups (id) on delete cascade,
  user_id     uuid not null references auth.users (id) on delete cascade,
  role        text not null default 'member' check (role in ('owner', 'mentor', 'member', 'student')),
  -- what the group may see of this member beyond their own posts: 'none' (default) or 'stats' (R-based figures)
  share_level text not null default 'none' check (share_level in ('none', 'stats')),
  joined_at   timestamptz not null default now(),
  primary key (group_id, user_id)
);
create index group_members_user on public.group_members (user_id);

create function public.is_group_member(p_group uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.group_members m where m.group_id = p_group and m.user_id = auth.uid());
$$;

-- 'owner' | 'mentor' | 'member' | 'student' of the caller in the group, null when not a member
create function public.group_role(p_group uuid) returns text
language sql stable security definer set search_path = '' as $$
  select m.role from public.group_members m where m.group_id = p_group and m.user_id = auth.uid();
$$;

-- the caller and p_user are in at least one common group
create function public.shares_group_with(p_user uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.group_members a
    join public.group_members b on b.group_id = a.group_id
    where a.user_id = auth.uid() and b.user_id = p_user
  );
$$;

revoke execute on function public.is_group_member(uuid) from public, anon;
revoke execute on function public.group_role(uuid) from public, anon;
revoke execute on function public.shares_group_with(uuid) from public, anon;
grant execute on function public.is_group_member(uuid) to authenticated, service_role;
grant execute on function public.group_role(uuid) to authenticated, service_role;
grant execute on function public.shares_group_with(uuid) to authenticated, service_role;

alter table public.groups enable row level security;
create policy "groups: read as member" on public.groups
  for select to authenticated using (public.is_group_member(id));
create policy "groups: mfa" on public.groups as restrictive
  for select to authenticated using (public.mfa_satisfied());
revoke all on public.groups from anon, authenticated;
grant select on public.groups to authenticated;

alter table public.group_members enable row level security;
create policy "group_members: read co-members" on public.group_members
  for select to authenticated using (public.is_group_member(group_id));
create policy "group_members: mfa" on public.group_members as restrictive
  for select to authenticated using (public.mfa_satisfied());
revoke all on public.group_members from anon, authenticated;
grant select on public.group_members to authenticated;

-- ── social_profiles: the pseudonym (never the e-mail / display name) ─────────────────────────────────────────────

create table public.social_profiles (
  user_id    uuid primary key references auth.users (id) on delete cascade,
  pseudonym  text not null unique check (char_length(pseudonym) between 5 and 40 and pseudonym ~ '^[[:alpha:]]+ [[:alpha:]]+ [0-9]{2,3}$'),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create trigger social_profiles_touch before update on public.social_profiles
  for each row execute function public.touch_updated_at();

alter table public.social_profiles enable row level security;
create policy "social_profiles: read own or co-member" on public.social_profiles
  for select to authenticated using ((select auth.uid()) = user_id or public.shares_group_with(user_id));
revoke all on public.social_profiles from anon, authenticated;
grant select on public.social_profiles to authenticated;

-- ── group_invites ───────────────────────────────────────────────────────────────────────────────────────────────
-- Invitation codes (`#community?invite=CODE`) with the role the joiner gets; created by owners / mentors.

create table public.group_invites (
  code       text primary key check (code ~ '^[A-Z0-9]{10}$'),
  group_id   uuid not null references public.groups (id) on delete cascade,
  role       text not null default 'member' check (role in ('mentor', 'member', 'student')),
  created_by uuid not null references auth.users (id) on delete cascade,
  max_uses   integer not null default 25 check (max_uses between 1 and 500),
  uses       integer not null default 0 check (uses >= 0),
  expires_at timestamptz not null default now() + interval '14 days',
  created_at timestamptz not null default now()
);
create index group_invites_group on public.group_invites (group_id);

alter table public.group_invites enable row level security;
create policy "group_invites: read as owner or mentor" on public.group_invites
  for select to authenticated using (public.group_role(group_id) in ('owner', 'mentor'));
revoke all on public.group_invites from anon, authenticated;
grant select on public.group_invites to authenticated;

-- ── group_reviews + comments: shared trades for a joint review ───────────────────────────────────────────────────
-- payload = the redacted trade (src/social/redact.ts, re-validated by the function). Visibility: in 'group' / 'team'
-- groups every member; in 'mentor' groups only the author and the owner / mentors (students never see each other).

create table public.group_reviews (
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.groups (id) on delete cascade,
  author_id   uuid not null references auth.users (id) on delete cascade,
  payload     jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  question    text not null default '' check (char_length(question) <= 500),
  status      text not null default 'open' check (status in ('open', 'done')),
  reviewed_by uuid references auth.users (id) on delete set null,
  reviewed_at timestamptz,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
create index group_reviews_group on public.group_reviews (group_id, created_at desc);
create index group_reviews_author on public.group_reviews (author_id);

create trigger group_reviews_touch before update on public.group_reviews
  for each row execute function public.touch_updated_at();

create function public.can_see_review(p_review uuid) returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
    from public.group_reviews r
    join public.groups g on g.id = r.group_id
    join public.group_members m on m.group_id = r.group_id and m.user_id = auth.uid()
    where r.id = p_review
      and (g.kind <> 'mentor' or r.author_id = auth.uid() or m.role in ('owner', 'mentor'))
  );
$$;
revoke execute on function public.can_see_review(uuid) from public, anon;
grant execute on function public.can_see_review(uuid) to authenticated, service_role;

alter table public.group_reviews enable row level security;
create policy "group_reviews: read visible" on public.group_reviews
  for select to authenticated using (public.can_see_review(id));
create policy "group_reviews: mfa" on public.group_reviews as restrictive
  for select to authenticated using (public.mfa_satisfied());
revoke all on public.group_reviews from anon, authenticated;
grant select on public.group_reviews to authenticated;

create table public.comments (
  id         uuid primary key default gen_random_uuid(),
  review_id  uuid not null references public.group_reviews (id) on delete cascade,
  author_id  uuid not null references auth.users (id) on delete cascade,
  body       text not null check (char_length(btrim(body)) between 1 and 1000),
  -- members mentioned with @Pseudonym (resolved by the function within the group)
  mentions   uuid[] not null default '{}' check (cardinality(mentions) <= 10),
  -- hidden after reports (3 distinct reporters) – from then on only its author still sees it
  hidden     boolean not null default false,
  created_at timestamptz not null default now()
);
create index comments_review on public.comments (review_id, created_at);
create index comments_author on public.comments (author_id);

alter table public.comments enable row level security;
create policy "comments: read visible" on public.comments
  for select to authenticated using (public.can_see_review(review_id) and (not hidden or author_id = (select auth.uid())));
create policy "comments: mfa" on public.comments as restrictive
  for select to authenticated using (public.mfa_satisfied());
revoke all on public.comments from anon, authenticated;
grant select on public.comments to authenticated;

-- ── group_goals: a mentor proposes a goal to a student (the student adopts it into P08's goals or declines) ─────

create table public.group_goals (
  id         uuid primary key default gen_random_uuid(),
  group_id   uuid not null references public.groups (id) on delete cascade,
  mentor_id  uuid not null references auth.users (id) on delete cascade,
  student_id uuid not null references auth.users (id) on delete cascade,
  -- a GoalDraft (src/domain/growth/goals.ts) without personal data, re-validated by the function
  draft      jsonb not null check (jsonb_typeof(draft) = 'object' and pg_column_size(draft) <= 4096),
  status     text not null default 'open' check (status in ('open', 'accepted', 'declined')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (mentor_id <> student_id)
);
create index group_goals_student on public.group_goals (student_id, created_at desc);
create index group_goals_group on public.group_goals (group_id);

create trigger group_goals_touch before update on public.group_goals
  for each row execute function public.touch_updated_at();

alter table public.group_goals enable row level security;
create policy "group_goals: read own" on public.group_goals
  for select to authenticated using ((select auth.uid()) in (mentor_id, student_id) and public.is_group_member(group_id));
revoke all on public.group_goals from anon, authenticated;
grant select on public.group_goals to authenticated;

-- ── shares: public links (`/#share/<token>`) ─────────────────────────────────────────────────────────────────────
-- token = 16 random bytes base64url (a capability URL). Only the owner reads their rows; the public reads ONE valid
-- share through `shared_payload()` in the function (rate-limited), never the table.

create table public.shares (
  id         uuid primary key default gen_random_uuid(),
  token      text not null unique check (token ~ '^[A-Za-z0-9_-]{22}$'),
  user_id    uuid not null references auth.users (id) on delete cascade,
  kind       text not null check (kind in ('trade', 'setup', 'stats')),
  payload    jsonb not null check (jsonb_typeof(payload) = 'object' and pg_column_size(payload) <= 16384),
  expires_at timestamptz,
  revoked_at timestamptz,
  views      integer not null default 0 check (views >= 0),
  created_at timestamptz not null default now()
);
create index shares_user on public.shares (user_id, created_at desc);

alter table public.shares enable row level security;
create policy "shares: read own" on public.shares
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.shares from anon, authenticated;
grant select on public.shares to authenticated;

-- One valid share by token (counts the view). Service role only – the function rate-limits per IP hash first.
create function public.shared_payload(p_token text)
returns table (kind text, payload jsonb, created_at timestamptz, expires_at timestamptz, views integer)
language sql volatile security definer set search_path = '' as $$
  update public.shares s set views = s.views + 1
  where s.token = p_token and s.revoked_at is null and (s.expires_at is null or s.expires_at > now())
  returning s.kind, s.payload, s.created_at, s.expires_at, s.views;
$$;
revoke execute on function public.shared_payload(text) from public, anon, authenticated;
grant execute on function public.shared_payload(text) to service_role;

-- ── feedback (incl. abuse reports) ──────────────────────────────────────────────────────────────────────────────

create table public.feedback (
  id          bigint generated always as identity primary key,
  -- null = sent without an account (only kind <> 'report')
  user_id     uuid references auth.users (id) on delete cascade,
  kind        text not null check (kind in ('bug', 'idea', 'praise', 'report', 'other')),
  message     text not null check (char_length(btrim(message)) between 3 and 2000),
  page        text check (page is null or page ~ '^[a-z0-9_-]{1,32}$'),
  target_type text check (target_type is null or target_type in ('comment', 'review', 'share', 'group')),
  target_id   text check (target_id is null or char_length(target_id) <= 64),
  meta        jsonb not null default '{}'::jsonb check (jsonb_typeof(meta) = 'object' and pg_column_size(meta) <= 2048),
  status      text not null default 'new' check (status in ('new', 'seen', 'done')),
  created_at  timestamptz not null default now(),
  check (kind <> 'report' or (user_id is not null and target_type is not null and target_id is not null))
);
create index feedback_created on public.feedback (created_at desc);
create index feedback_target on public.feedback (target_type, target_id) where kind = 'report';
-- one report per reporter and target
create unique index feedback_report_once on public.feedback (user_id, target_type, target_id) where kind = 'report';

alter table public.feedback enable row level security;
create policy "feedback: read own" on public.feedback
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.feedback from anon, authenticated;
grant select (id, kind, message, page, target_type, target_id, status, created_at) on public.feedback to authenticated;

-- ── member_stats / leaderboard_snapshots / community_stats (nightly `social-aggregate`) ──────────────────────────
-- member_stats: R-based figures of opted-in users (ranking opt-in OR share_level 'stats' somewhere), computed from
-- their synced trades (last 90 days). Users read their own row; groups see a member's row only through the function
-- and only with share_level 'stats'.

create table public.member_stats (
  user_id      uuid primary key references auth.users (id) on delete cascade,
  computed_at  timestamptz not null default now(),
  window_days  smallint not null default 90 check (window_days between 7 and 366),
  trades       integer not null default 0 check (trades >= 0),
  r_trades     integer not null default 0 check (r_trades >= 0),
  expectancy_r numeric(6, 2),
  win_rate     numeric(5, 2) check (win_rate is null or win_rate between 0 and 100),
  discipline   numeric(5, 2) check (discipline is null or discipline between 0 and 100),
  consistency  numeric(5, 2) check (consistency is null or consistency between 0 and 100),
  eligible     boolean not null default false
);

alter table public.member_stats enable row level security;
create policy "member_stats: read own" on public.member_stats
  for select to authenticated using ((select auth.uid()) = user_id);
revoke all on public.member_stats from anon, authenticated;
grant select on public.member_stats to authenticated;

-- Ranks of one day per metric (eligible opted-in users only). Read through the function, which also drops anyone who
-- opted out since (the withdrawal works at once, not only after the next night). No client privilege.
create table public.leaderboard_snapshots (
  day     date not null,
  metric  text not null check (metric in ('expectancy', 'discipline', 'consistency')),
  user_id uuid not null references auth.users (id) on delete cascade,
  rank    integer not null check (rank >= 1),
  value   numeric(8, 2) not null,
  trades  integer not null check (trades >= 0),
  primary key (day, metric, user_id)
);
create index leaderboard_snapshots_rank on public.leaderboard_snapshots (metric, day desc, rank);

alter table public.leaderboard_snapshots enable row level security;
revoke all on public.leaderboard_snapshots from anon, authenticated;

-- Community distribution per metric. k-anonymity enforced by the database: fewer than 10 traders → no row.
create table public.community_stats (
  day    date not null,
  metric text not null check (metric in ('expectancy', 'discipline', 'consistency', 'winrate')),
  n      integer not null check (n >= 10),
  p10    numeric(8, 2) not null,
  p25    numeric(8, 2) not null,
  p50    numeric(8, 2) not null,
  p75    numeric(8, 2) not null,
  p90    numeric(8, 2) not null,
  mean   numeric(8, 2) not null,
  primary key (day, metric),
  check (p10 <= p25 and p25 <= p50 and p50 <= p75 and p75 <= p90)
);

alter table public.community_stats enable row level security;
create policy "community_stats: read" on public.community_stats
  for select to authenticated using (true);
revoke all on public.community_stats from anon, authenticated;
grant select on public.community_stats to authenticated;

-- Users the nightly aggregate computes: ranking opt-in (`profiles.privacy.leaderboard`) or sharing stats with a group.
-- Keyset-paged by user id. Service role only.
create function public.social_candidates(p_after uuid default null, p_limit integer default 500)
returns table (user_id uuid, leaderboard boolean)
language sql stable security definer set search_path = '' as $$
  select u.user_id, bool_or(u.lb)
  from (
    select p.id as user_id, true as lb from public.profiles p where p.privacy @> '{"leaderboard": true}'::jsonb
    union all
    select m.user_id, false from public.group_members m where m.share_level = 'stats'
  ) u
  where p_after is null or u.user_id > p_after
  group by u.user_id
  order by u.user_id
  limit least(greatest(coalesce(p_limit, 500), 1), 1000);
$$;
revoke execute on function public.social_candidates(uuid, integer) from public, anon, authenticated;
grant execute on function public.social_candidates(uuid, integer) to service_role;
