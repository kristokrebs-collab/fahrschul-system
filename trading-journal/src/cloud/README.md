# `src/cloud` – login, sync, 2FA, sessions, privacy, error reports (P09)

Local-first stays the default. Without `VITE_SUPABASE_URL` + `VITE_SUPABASE_PUBLISHABLE_KEY` (and always in the
single-file builds, on `file://` and on claude.ai) nothing here talks to a server: `isCloudAvailable()` / `cloudEnabled()`
is false, the Konto page shows an honest "Cloud nicht eingerichtet", the header pill renders nothing.

With a cloud the user can sign in (password, magic link, optional OAuth, reset, e-mail confirmation), protect the account
with TOTP 2FA, see and sign out the other devices, and sync the journal across devices – offline-first, three-way,
lossless. DSGVO tools (export, deletion, nightly backups, audit trail) run in the Netlify functions
(`netlify/functions/README.md`), the schema in `supabase/`.

## Bundle shape

| module | weight | what |
|---|---|---|
| `index.ts` | light barrel | the Wave-0 contract (`isCloudAvailable`, `useCloudUser`, `apiFetch`, `ApiError`, `getAccessToken`, `reportError`, `installErrorReporting`) + session / privacy / sync-status hooks, `ensureCloud`, `signOut` |
| `env.ts`, `api.ts`, `session.ts`, `privacy.ts`, `report.ts`, `scrub.ts`, `hint.ts`, `idle.ts`, `runtime.ts`, `sync/status.ts` | light (zustand only) | always in the main bundle |
| `client.ts` (+ `sync/*`) | **lazy chunk** with `@supabase/supabase-js` | loaded by `ensureCloud()` only when a login is stored, an auth callback is in the URL, or the login sheet opens |
| `ui/*`, `CloudSyncHost.tsx` | UI | the host loads `AuthSheet` lazily on first open; the Konto page is lazy via `pages.ts` (P14) |

`scrub.ts` and `sync/docs.ts` are alias-free on purpose: the functions import them by relative path.

## Auth (`client.ts`, `session.ts`, `authErrors.ts`)

- `createClient` with `auth.storageKey = KEYS.cloudAuth` (`tj2-sb-auth` / `tj2share-sb-auth` – the editions never share a
  login on one origin), **PKCE** (magic link / OAuth / reset return as `?code=` – the hash router keeps its `#page`; the URL is
  cleaned afterwards, a failed / expired link becomes a German toast), auto refresh, `x-client-info`.
- `onAuthStateChange` never awaits Supabase inside the callback (supabase-js holds its auth lock there) – it defers
  `refreshAuthState()` which writes `useCloudSession` (`phase`, `user {id,email,aal,mfaEnrolled}`, `needsMfa`, `factors`,
  `provider`, `emailConfirmed`, `sessionId`). `PASSWORD_RECOVERY` opens the sheet on `Neues Passwort`.
- Actions return `ActionResult` (`{ ok: true, value? }` or `{ ok: false, message, field }`) with German text from
  `authErrorText()` (Supabase codes + message fallbacks; `field` = which input shakes).
- `apiFetch` gets the bearer token (`setAccessTokenProvider`). A 200 **HTML** answer (SPA fallback of a host without the
  functions) is an `ApiError(0, "unavailable", FUNCTIONS_MISSING)` – never parsed as data.
- Security events that happen against Supabase directly (sign-in, 2FA on/off/verify, other devices signed out, password)
  are posted to `/api/v1/audit` (best effort).

### 2FA (TOTP)

`enrollTotp()` (removes a half-finished factor first; the QR SVG is re-encoded into a safe data URL) → `verifyTotp(factor,
code, "enroll")` (challenge + verify → session aal2) · `verifyLoginCode(code)` (step-up after a password login) ·
`unenrollTotp()` (needs aal2). The database enforces it: `journal_docs` / `exchange_connections` refuse aal1 sessions of
accounts with a verified factor (`mfa_satisfied()`); the sync waits in `locked` until the code is in.

### Sessions & idle sign-out

`listSessions()` → `rpc("my_sessions")` (own sessions, IP coarsened to /24, this device first). `signOutScope("others")`
signs every other device out (their access tokens run out within the hour). `idle.ts`: Nie / 30 Min / 2 Std / 8 Std
(`<prefix>cloud-idle`); passive listeners + one 30-s check, the last activity is written at most once a minute, so a browser
closed for days is signed out at its next start. Signing out never deletes the local journal.

## Sync (`sync/*`)

```
UI write ──► SupabaseAdapter.api ──► local adapter (localStorage, synchronous, full-list patch → store)
                                 └─► engine.markDirty("trade", id) ─► outbox (IndexedDB) ─► upsert journal_docs
Realtime / catch-up ──► engine.applyRows ──► decide() per record ──► local.replaceParts(changed parts) ─► store patch
start / reconnect / "Jetzt synchronisieren" ──► pullAll ──► three-way reconcile against the sync base
```

- **Local-first**: the app always reads localStorage; offline everything keeps working (`saveTradeNow().persisted` stays
  true). The outbox (`idb-keyval`, db `<prefix>cloud`, one entry per user) holds only KEYS with a generation – content is
  read at upload time, a record edited five times uploads once; without IndexedDB it lives in memory (the reconcile at the
  next start finds every change anyway).
- **Rows** (`docs.ts`): `journal_docs(user_id, kind, id) → data`, kinds `trade` · `hyblock` · `day` (`YYYY-MM-DD`) ·
  `settings` (`id = "settings"`, optimistic `rev`). Deletes are **tombstones** (`deleted`, `data = { deletedAt }`).
- **Three-way** (`reconcile.ts`, table in the file): the sync base (`KEYS.cloudBase`: owner, content hash per record,
  settings + rev as last synced) tells "changed here" from "changed there". Both sides are hashed in normalised form.
  Conflicts: newer `updatedAt`, ties by hash (every device picks the same winner). **An edit beats a delete**, and nothing
  local is ever deleted because a row is merely missing remotely.
- **Settings**: `merge3(base, mine, theirs)` with an optimistic `rev` write (`update … where rev = $seen`); a lost race
  refetches, merges and retries.
- **First login of this browser** (no base): a safety snapshot `tj2-backup-import-<ISO>` first (no snapshot → no sync),
  then `applyBackup(remote, local, "merge", ALL_PARTS)` → `local.replaceAll` → upload the differences → toast
  (`Sync aktiv · n Einträge` or `n Konflikte zusammengeführt`). A base of ANOTHER account: the local journal stays in the
  snapshot, the new account's journal replaces it locally, nothing is uploaded into the wrong account.
- **Realtime** `postgres_changes` on `journal_docs` (filter `user_id=eq.<uid>`), batched (`batchMs`); own echoes are no-ops
  (same hash). Realtime down → catch-up `pullSince(serverAt)` every minute while visible and on reconnect. Rows without
  `data` (large unchanged values) trigger a catch-up read.
- **Errors**: network → `offline` (header `Offline`), retry 3 s → 10 s → 30 s → 1 min → 5 min and on `online`; RLS refusals
  → `error` with `Die Cloud lehnt den Zugriff ab …`. Every operation runs exclusively (one queue).
- **Controller** (`controller.ts`): sync runs while signed in AND 2FA satisfied AND `privacy.sync` AND the plan includes
  `cloudSync` (P10 `useEntitlement`, passed by the host) AND not on claude.ai; otherwise the local adapter. Switching uses
  `switchAdapter()` (`@/store/journalStore`).
- Status for the UI: `useSyncStatus()` (`phase` off · paused · locked · connecting · syncing · live · offline · error,
  `pending`, `records`, `lastSyncAt`, `realtime`, `progress`, `conflicts`, `pings`).

## Privacy & error reports

`privacy.ts`: `sync` (device-local, default on), `telemetry` (default OFF), `leaderboard` (default off, P12 reads
`useLeaderboardOptIn()`); `telemetry` / `leaderboard` mirror into `profiles.privacy` when signed in.

`report.ts`: `reportError(error, { source, componentStack?, extra? })` posts to `/api/v1/log` only with cloud + telemetry
opt-in; scrubbed (`scrub.ts`: no e-mails, tokens, ids, IPs, query strings / fragments, no number ≥ 3 digits – stack
positions survive), de-duplicated per fingerprint, ≤ 5 per page session, never re-entrant, never throws.
`installErrorReporting()` wires `error` / `unhandledrejection` (idempotent; the host installs it; P13's ErrorBoundary calls
`reportError(e, { source: "boundary", componentStack })`).

## UI (`ui/*`) and effects

| export | where | motion |
|---|---|---|
| `AccountPill` | app header (P14) | `Anmelden` pill; the login sheet **morphs out of it** (`layoutId="auth-sheet"`, `spring.sheet`, pill `visibility:hidden` while open); signed in: avatar + `StatusPill` (`Sync · live` …) pinging per realtime patch / upload (`pingKey`, ≤ 4/s); phones: status dot on the avatar |
| `AuthSheet` (via `CloudSyncHost`) | overlay | views slide sideways in order (variant labels so every view's `StaggerItem`s cascade), fields shake + loss ring on errors (`Field invalidKey`), submit labels morph (`TextRoll`), password strength bars grow (`spring.bar`), envelope draws itself + resend countdown (`RollingDigits`); 2FA code on rolling slots; welcome: `AsciiCascade` wordmark, `DotMatrix` wave while the first sync uploads (progress on `RollingDigits`), drawn ✓ + `celebrateFrom(…, { kind: "streak" })` when live |
| `AuthCard` | Konto | headline words rise, benefit icons draw (`tween.draw`), magnetic CTA; signed in: e-mail decodes (`TextScramble`), password form springs open (clip-path) |
| `SecurityCard` | Konto | QR **dither wipe** (`QrReveal`: 12 stepped clip-path frames + 8×8 Bayer ink grid fading), `CodeSlots`, activation by **hold** (`HoldButton`) → badge pop + confetti; device rows slide in, ages morph (`TextRoll`) |
| `SyncStatusCard` | Konto | big Doto counters (`RollingDigits`), `DotMatrix` wave while syncing (stops at rest), progress scaleX, `PulseDot` rings |
| `PrivacyCard` | Konto | elastic `Switch` rows, win edge crossfade |
| `AccountDataCard` | Konto | export (spinner → ✓), cloud backups (hold to restore), audit timeline cascade; delete = type `LÖSCHEN` + **hold** → `PixelDissolve` (seeded 12×6 cell dissolve, opacity only) |
| `CloudUnavailableCard` | Konto | struck-through dot-matrix cloud (static) + local-first facts |

Rules: transform / opacity / filter / clip-path only, timings from `tokens.ts`, reduced motion → static end states,
reveals end at `transform: none`, decorative layers `aria-hidden`, no `aria-live` (ToastIsland is the only one), finite
loops (the DotMatrix wave plays only while a sync runs). `auth-sheet` belongs in the layoutId table of
`src/motion/README.md` (P01 owns that file – the integrator adds the row).

## Host (`CloudSyncHost`)

Mount once in `App` (after `SetupEditor`, before `Celebrate`): boots the cloud (restores a stored login – lazy chunk – or
settles signed out without loading anything), installs the error reporting, passes `useEntitlement("cloudSync")`, runs the
idle sign-out, mounts the lazy `AuthSheet` from its first open on. Prop `onOpenAccount` (→ `navigate("konto")`). StrictMode
safe. Inert on claude.ai and without cloud config.

## Tests

`tests/unit/cloud.sync.test.ts` (reconcile table + engine against an in-memory `journal_docs`: first-login merge,
tombstones, three-way edits, settings rev race, offline queue, account switch, snapshot abort), `cloud.helpers.test.ts`,
`cloud.ui.test.tsx`, `cloud.store.test.ts`, `cloud.contract.test.ts`; functions: `functions.account.test.ts`.
e2e: `tests/e2e/cloud.spec.ts` with the full Supabase / functions mock `tests/e2e/mocks/supabase.ts` (GoTrue, PostgREST,
Realtime over `routeWebSocket`, `/api/v1/*`); dev harness `dev/konto.html` until the page is routed.
