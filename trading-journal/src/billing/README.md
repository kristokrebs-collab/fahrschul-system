# `src/billing` – plans, gates, Stripe flows (P10)

Free · Pro · Premium · Team, monthly or yearly, 14-day trial (30 via an invitation), promotion codes, referrals /
affiliates, invoices, in-app cancellation. Stripe is reached **only** by the Netlify functions
(`netlify/functions/billing-*.mts`, `stripe-webhook.mts`, `_lib/stripe.ts`); the browser follows the Checkout / Customer
Portal URLs they return (plain redirects to `*.stripe.com`, no Stripe.js, nothing in the CSP).

## Modes – what is gated when

| mode (`useBillingMode()`) | when | gates | UI |
|---|---|---|---|
| `off` | no cloud: file builds, `file://`, claude.ai, no `VITE_SUPABASE_*` | everything unlocked | pricing page shows the plans + "Keine Abos in dieser Version"; Konto cards render nothing |
| `closed` | cloud yes, payments not set up (`/billing/status` → `enabled: false`, or the functions are missing) | everything unlocked (server: `requireFeature` passes too) | "Zahlungen noch nicht eingerichtet", buttons say "Noch nicht buchbar" |
| `open` | Stripe configured | `plans.ts` matrix of the effective plan; signed out = Free | full flows |

The plan is never decided in the browser: `/api/v1/billing/status` reads `profiles.plan` (written only by the Stripe
webhook) and the client mirrors it. The last known plan per user is cached (`<prefix>billing`) so the gates stay steady
across reloads (also while a stored login is being restored); it is never applied to another user.

## Files

| file | what |
|---|---|
| `types.ts` | Wave-0 vocabulary (`PLAN_IDS`, `FEATURES`, `LIMIT_KEYS`, `PlanInfo`, `grantsPlan`) – pure, imported by the functions |
| `plans.ts` | **owner-editable** catalog: feature matrix (`PLAN_FEATURES`), limits (`PLAN_LIMITS`), list prices (`LIST_PRICES`, cents), card copy (`PLAN_CATALOG`: tagline, the 4 strongest highlights, glyph, recommended), `FEATURE_INFO`; helpers `planIncludes`, `limitOf`, `upgradePlanFor`, `upgradePlanForLimit`, `featuresGained`, `yearlySavingsPct`, `discounted`, `catalogProblems` – pure, imported by the functions (`requireFeature`) |
| `contract.ts` | wire types of the functions (`BillingStatus`, `CheckoutRequest`, `PortalRequest`, `CodeLookup`, `ReferralInfo`, …) + validators (`normalizeRefCode`, `normalizePromoCode`, `safeReturnTo`) – pure, shared with the functions |
| `entitlements.ts` | the Wave-0 contract, final: `useEntitlement(feature)`, `useLimit(key)`, `usePlan()`, `<Gate feature fallback>` |
| `store.ts` | zustand store + flows: `loadBilling`, `startCheckout` (signed out → login sheet first, continued by the host), `openPortal(flow)`, `changeSubscription("cancel"|"resume"|"pause")`, `checkCode`, `verifyReferral`, `loadReferral`, `openUpgrade(feature?, plan?)`, `openCancel`; derived `useBillingMode`, `useEffectivePlan`, `useTrialDays` |
| `api.ts` | `apiFetch` wrappers; `redirectToStripe(url)` follows only https `*.stripe.com` |
| `url.ts` | `?ref=` capture (30 days, `<prefix>billing-ref`), Stripe return (`?billing=success|cancel|portal`) – both removed from the address bar |
| `format.ts` | German money / dates / status lines (`formatMoney`, `displayPrice` – Stripe's real price wins over the list price –, `nextLine`) |
| `strings.ts` | German copy |
| `ui/*` | components (below) |

## Components (`@/billing/ui`)

| export | where (P14 wiring) | motion |
|---|---|---|
| `BillingHost` | once in `App`, leaf host after `CloudSyncHost` | mounts `UpgradeSheet`, `CancelSheet`, `CheckoutReturn`; reads `?ref` / the Stripe return; loads status when the session settles; continues a checkout that waited for the login; frees buttons on a bfcache return |
| `BillingBanner` | app shell under the `LocalModeBanner` | `WarnBanner` (drop + clip wipe, finite pings): failed payment → "Zahlung aktualisieren"; trial ends in ≤ 3 days (+ "Zahlungsmittel hinterlegen" without a card); paused → "Fortsetzen"; dismissable per session |
| `PlanCard` | Konto (`extraCards`) | plan name decodes in (`AsciiCascade`) next to its `DotMatrixText` glyph tile, trial days on `RollingDigits` + draining bar, status badge, one `BorderBeam` lap when the plan changes; **"Vertrag hier kündigen" always visible while an abo runs** (§ 312k BGB); optional `usage` → `LimitMeter`s |
| `BillingCard` | Konto | invoices from Stripe (cascade via `RevealGroup`, links only to Stripe-hosted pages), "Zahlungsmittel ändern", portal |
| `ReferralCard` | Konto | own code decodes in (`TextScramble`), copy link (✓ pops), counters on `RollingDigits`, credits ledger |
| `UpgradeTeaser` | `<Gate fallback>` | lock pops in on first view (`spring.pop`), feature name gets the `TactileHighlight` marker; "Freischalten" → `UpgradeSheet` |
| `UpgradeSheet` | via `BillingHost` | `Sheet`; feature wipes in with `TactileHighlight` as the sheet lands, plan + Monat/Jahr `Segmented`, price on `RollingDigits`, gained features tick in (drawn checks) |
| `CancelSheet` | via `BillingHost` | reason → offer (pause / cheaper plan, only when it fits, always skippable) → confirm "Jetzt kündigen" → done (drawn ✓, "Kündigung zurücknehmen"); steps slide on `spring.enter`; portal cancel flow as alternative |
| `CheckoutReturn` | via `BillingHost` | `FullscreenWipe`: DotMatrix wave while the webhook lands (status polled ≤ 10×), then "Willkommen bei <Plan>" (`AsciiCascade`) + `celebrateRecord` from the button; honest "Stripe braucht einen Moment" when slow |
| `LimitMeter` | wherever a limit is used (`<LimitMeter limitKey="savedViews" used={n} />`) | rolling count, bar fills on first view (`useFirstInView`), warn + "Mehr mit Pro" at the limit |

Rules kept: transform / opacity / filter / clip-path only; timings from `tokens.ts`; reduced motion → static end states;
in-view effects through `useFirstInView` (guarded, intro-gated); decorative layers `aria-hidden`; no `aria-live` (toasts go
through the island); the busy DotMatrix wave unmounts with the confirmation. No new `layoutId`s.

## Tests

`tests/unit/billing.plans.test.ts` (matrix, prices, validators, URL state), `billing.store.test.tsx` (modes, cache, gates,
flows against a stubbed fetch), `billing.ui.test.tsx` (cards, teaser → sheet, cancellation, pricing page),
`billing.contract.test.tsx` (Wave-0 contract), `functions.stripe.test.ts` (server). e2e: `tests/e2e/preise.spec.ts` with
`tests/e2e/mocks/billing.ts` (fake functions + fake Stripe Checkout / Portal pages) on the dev harness `dev/preise.html`.
