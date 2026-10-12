# `src/social` – community client (P12)

Groups, mentor / student, teams, joint reviews with comments and `@mentions`, mentor goals, share links, pseudonymous
rankings, anonymous percentile comparison and feedback. Everything is **opt-in** and **redacted**: the server
(`netlify/functions/social-*.mts`, `feedback.mts`, `_lib/social/*`, migration `0004_social.sql`) is the only writer;
the browser sends redacted payloads and reads what membership allows.

Without a cloud (file builds, `file://`, claude.ai, no `VITE_SUPABASE_*`) `communityEnabled()` is `false`: no request is
ever made, the Community page shows its honest "Community braucht die Cloud" state, a trade can still be shared **as a
picture** (PNG, nothing leaves the device), setup sharing hides itself.

## Privacy rules (what the code guarantees)

- **Redaction** (`redact.ts`, re-checked by the server against the strict schemas of `contract.ts` – unknown keys →
  422): a shared trade carries pair, side, timeframe, entry day, result, R, move in %, planned R:R, rating, plan /
  checklist, MAE / MFE in R; prices + leverage, time, setup name and tags only when the trader switches them on. **Never** PnL, size, fees, notes, account, exchange ids.
  A setup carries its rules and R-figures; stats are R / % only.
- **Pseudonyms** (`pseudonym.ts`): people appear as "Stiller Falke 27" (+ a dot-matrix monogram), never under an e-mail
  or display name; re-roll 3× a day.
- **Ranking opt-in** (`profiles.privacy.leaderboard`, also synced into the P09 privacy settings): off by default,
  withdrawal is immediate (server deletes the snapshot rows and filters at read time).
- **k-anonymity**: group averages and community distributions only from ≥ 10 people (`K_ANON`); no percentile ring
  below that.
- **Groups**: a member's figures reach a group only with `share_level = "stats"` (switch per group); mentor-group
  students see only their own reviews; strangers get 404.
- **Abuse**: report on every comment / review / shared link (`sendFeedback({ kind: "report", target })`), server rate
  limits, comments hidden after 3 reports.

## Files

| file | what |
|---|---|
| `metrics.ts` | PURE, alias-free (imported by the functions): the community figures over 90 days – Expectancy R (capped ±10 R), Disziplin (plan followed, no mistakes), Konsistenz (positive weeks), win rate; minimums (`MIN_TRADES` 20 R trades, 4 weeks), `rankRows` (competition ranks), `quantiles` (null below k), `percentileOf` |
| `pseudonym.ts` | PURE, alias-free: `pseudonymFrom(bytes)`, `monogramOf`, `matrixSafe`, `PSEUDONYM_RE` |
| `contract.ts` | PURE, alias-free: the wire contract – strict zod schemas of shared payloads (`SharedTrade/Setup/Stats`), request bodies (share, group, invite, join, member patch, review, comment, goal, feedback, leaderboard action) and response types |
| `redact.ts` | `redactTrade(trade, opts, setups)`, `redactSetup(setup, figures)`, `redactStats`, `sharedDetails`, `REDACT_DEFAULTS` |
| `format.ts` | PURE: German R / % formatting, metric labels / hints, `shareTitle` (used by the functions too) |
| `links.ts` | `shareUrl(token)` → `<origin>/#share/<token>` (never `/teilen/`), `inviteUrl(code)` → `/#community?invite=CODE`, `parseShareHash`, `parseInvite`, `clearInviteFromUrl` |
| `api.ts` | `apiFetch` wrappers of every route (`fetchShared` without auth) |
| `store.ts` | zustand store `useSocial` + flows: `loadCommunity`, `loadFeed`, `loadBoard`, `setOptIn`, `refreshMe`, `rerollPseudonym`, groups (`createGroup`, `deleteGroup`, `leaveGroup`, `removeMember`, `setShareLevel`, `setRole`), invites (`createInvite`, `revokeInvite`, `checkInvite`, `joinGroup`), reviews / comments, goals (`proposeGoal`, `adoptGoal` → P08 `addGoalFromDraft`, `declineGoal`), shares (`createShareLink`, `revokeShareLink`, `openShare`), page sheets (`openSheet` / `closeSheet`), `sendFeedback`; one `busy` slot per action, German error toasts; `resetSocial` on sign-out |
| `hooks.ts` | `useCommunityBoot` (loads on sign-in, keeps a pending `?invite=` across the login), `useLocalStats` (the same figures from this device's journal, shown until the server computed them), `percentileIn`, `myValue` |
| `adopt.ts` | `withAdoptedSetup(settings, payload)` – a shared setup becomes the visitor's own (unique name, fresh id) |
| `strings.ts` | German copy |
| `ui/*` | parts used outside the Community page (below) |

## Components (`@/social/ui`)

| export | where (P14 wiring) | motion |
|---|---|---|
| `SocialHost` | once in `App` (after `SetupEditor`, before `Celebrate`, `data-layer`) | mounts the one `ShareSheet`; inert until `openShare(…)`, no network on mount |
| `ShareButton` | `TradeDetail` → `<ShareButton tradeId={t.id} />`; optional setup card → `<ShareButton setupId={s.id} />` | – |
| `ShareSheet` | via `SocialHost` | the share card is **born via `GlyphZoom`** (share glyph dives into the card after the sheet settled); field toggles; link → copy toast (`ToastIsland`), native share, PNG download; "In Gruppe besprechen" |
| `TradeShareCard`, `SetupShareCard`, `StatsShareCard`, `PayloadCard` | share sheet, public `SharedView`, review feed | static |
| `Monogram` | pseudonym monogram (DotMatrix, decorative) | – |

The Community page and the public share page live in `src/views/community` (see its README).

## Tests

`tests/unit/social.metrics.test.ts`, `tests/unit/social.redact.test.ts` (figures, ranks, quantiles / k, redaction never
leaks money / notes, strict schemas), `tests/unit/social.ui.test.tsx` (view states, share sheet, cards, mentions),
`tests/unit/functions.social.test.ts` (server), `tests/e2e/community.spec.ts` (+ `tests/e2e/mocks/social.ts`, an
in-memory server that validates every payload with the real strict schemas).
