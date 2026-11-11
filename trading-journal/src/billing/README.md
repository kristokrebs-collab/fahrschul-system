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
| `tariff.ts` | **A1 tariff contract per function** (`docs/TARIFE.md`): one row for each of F01–F74 – name, goal, `core` (feature needed at its heart, `null` = Free), `extras` (parts from higher plans), `limits` (quotas); `startPlanOf`, `fullPlanOf`, `accessOf`, `tariffByGoal`, `tariffSnapshot` – pure, imported by lazy pages and tests, not by the first load. `tests/unit/billing.tariff.test.ts` holds it against the register (`gate` / `limit`) and the server |
| `contract.ts` | wire types of the functions (`BillingStatus`, `CheckoutRequest`, `PortalRequest`, `CodeLookup`, `ReferralInfo`, …) + validators (`normalizeRefCode`, `normalizePromoCode`, `safeReturnTo`) – pure, shared with the functions |
| `entitlements.ts` | the Wave-0 contract, final: `useEntitlement(feature)`, `useLimit(key)`, `usePlan()`, `<Gate feature fallback>` |
| `store.ts` | zustand store + flows: `loadBilling`, `startCheckout` (signed out → login sheet first, continued by the host), `openPortal(flow)`, `changeSubscription("cancel"|"resume"|"pause")`, `checkCode`, `verifyReferral`, `loadReferral`, `openUpgrade(feature?, plan?)`, `openCancel`; derived `useBillingMode`, `useEffectivePlan`, `useTrialDays` |
| `api.ts` | `apiFetch` wrappers; `redirectToStripe(url)` follows only https `*.stripe.com` |
| `url.ts` | `?ref=` capture (30 days, `<prefix>billing-ref`), Stripe return (`?billing=success|cancel|portal`) – both removed from the address bar |
| `format.ts` | German money / dates / status lines (`formatMoney`, `displayPrice` – Stripe's real price wins over the list price –, `nextLine`) |
| `strings.ts` | German copy |
| `ui/*` | components (below) |

## Tariff contract (A1)

Free: 1 read-only exchange connection with manual sync (`exchangeConnections: 1`, `backgroundSyncConnections: 0`), 1 TradingView connection. New limit keys: `backgroundSyncConnections`,
`tvConnections`, `alertChannels`, `phoneCallsPerMonth`, `simulationsPerDay` (plus the existing `coachAiPerDay`, `shotExtractPerDay`); the values are a PROPOSAL the operator releases
(`docs/TARIFE.md`, decision E8). `LIMIT_INFO[k].state` is `live` (the function exists, shown on the price page) or `geplant` (defined, function not built – hidden everywhere until its package
ships: `tvConnections` B3, `alertChannels` / `phoneCallsPerMonth` C2, `simulationsPerDay` A3). Server, browser and cron read the same helpers (`autoSyncAllowed`, `exchangeAccessAllowed`,
`planIncludes`, `limitOf`). The price comparison is grouped by the goals of a trader (`GOAL_NAME`, `COMPARISON_GOALS`, `featuresOfGoal`).

## Components (`@/billing/ui`)

| export | where (P14 wiring) | motion |
|---|---|---|
| `BillingHost` | once in `App`, leaf host after `CloudSyncHost` | mounts `UpgradeSheet`, `CancelSheet`, `ContractHost` and – lazily – the purchase chunk `purchase/PurchaseHost` (order sheet, tariff detail, management, result page); reads `?ref` / the Stripe return; loads status when the session settles; continues a checkout that waited for the login; frees buttons on a bfcache return |
| `BillingBanner` | app shell under the `LocalModeBanner` | `WarnBanner` (drop + clip wipe, finite pings): failed payment → "Zahlung aktualisieren"; trial ends in ≤ 3 days (+ "Zahlungsmittel hinterlegen" without a card); paused → "Fortsetzen"; dismissable per session |
| `PlanCard` | Konto (`extraCards`) | plan name decodes in (`AsciiCascade`) next to its `DotMatrixText` glyph tile, trial days on `RollingDigits` + draining bar, status badge, one `BorderBeam` lap when the plan changes; **"Vertrag hier kündigen" always visible while an abo runs** (§ 312k BGB); optional `usage` → `LimitMeter`s |
| `BillingCard` | Konto | invoices from Stripe (cascade via `RevealGroup`, links only to Stripe-hosted pages), "Zahlungsmittel ändern", portal |
| `ReferralCard` | Konto | own code decodes in (`TextScramble`), copy link (✓ pops), counters on `RollingDigits`, credits ledger |
| `UpgradeTeaser` | `<Gate fallback>` | lock pops in on first view (`spring.pop`), feature name gets the `TactileHighlight` marker; "Freischalten" → `UpgradeSheet` |
| `UpgradeSheet` | via `BillingHost` | `Sheet`; feature wipes in with `TactileHighlight` as the sheet lands, plan + Monat/Jahr `Segmented`, price on `RollingDigits`, gained features tick in (drawn checks) |
| `CancelSheet` | via `BillingHost` | reason → offer (pause / cheaper plan, only when it fits, always skippable) → confirm "Jetzt kündigen" → done (drawn ✓, "Kündigung zurücknehmen"); steps slide on `spring.enter`; portal cancel flow as alternative |
| `LimitMeter` | wherever a limit is used (`<LimitMeter limitKey="savedViews" used={n} />`) | rolling count, bar fills on first view (`useFirstInView`), warn + "Dieses Limit gehört zu Pro" at the limit (Paket P: a fact, no push) |

Rules kept: transform / opacity / filter / clip-path only; timings from `tokens.ts`; reduced motion → static end states;
in-view effects through `useFirstInView` (guarded, intro-gated); decorative layers `aria-hidden`; no `aria-live` (toasts go
through the island); the busy DotMatrix wave unmounts with the confirmation. No new `layoutId`s.

## Tests

`tests/unit/billing.plans.test.ts` (matrix, prices, validators, URL state), `billing.store.test.tsx` (modes, cache, gates,
flows against a stubbed fetch), `billing.ui.test.tsx` (cards, teaser → sheet, cancellation, pricing page),
`billing.contract.test.tsx` (Wave-0 contract), `functions.stripe.test.ts` (server). e2e: `tests/e2e/preise.spec.ts` with
`tests/e2e/mocks/billing.ts` (fake functions + fake Stripe Checkout / Portal pages) on the dev harness `dev/preise.html`.


## Purchase flow (B4: Kaufstrecke, Bezahlfenster, Abo-Modelle) – ENTWURF, Anwalt prüft

One path: **Tarifkarte** (`views/preise/PlanGrid`, glass cards, Monat/Jahr with rolling digits, Team seats stepper, Premium with one border-beam lap) → optional **Tarif im Detail** (`purchase/TariffDetailSheet`: benefit, included, limits, unlocks – from `plans.ts` / `tariff.ts` only) → **Bezahlfenster** (`purchase/PayWindow`, Paket V: step band, card left, form right; plan, interval, seats, total, price AFTER the trial with date, renewal date, cancellation, tax sentence by Stripe-Tax state, two separate unticked boxes, button exactly „Zahlungspflichtig bestellen“) → **in the app with Stripe Elements** (publishable key set, Stripe Tax off) **or Stripe Checkout** (fallback) → **Ergebnisseite** (`views/preise/ResultView`, five states, the return URL confirms nothing: only `billing-status`, written by the webhook, says „aktiv“; backoff 0.8 → 6 s, ≈ 60 s, then „Wir warten noch auf die Bestätigung von Stripe“).

| file | what |
|---|---|
| `purchase/order.ts` | pure: `summarize` (price after trial, first payment, renewal), `yearlySaving` / `planSaving` (computed from the SHOWN prices – list prices unless Stripe reports others), `addInterval`, `orderReadiness`, the `order:<plan>.<interval>.<seats>` grammar of `returnTo` |
| `purchase/result.ts` | pure state machine `resultStateOf` (confirmed · pending · action · canceled · failed; `staleId` = the older subscription of the account), `pollDelay`, `pollAttempts`, the honest texts |
| `purchase/orderState.ts` | lazy store of the sheet (boxes never pre-ticked, `orderId` = idempotency key, `phase`), `submitOrder` (the ONLY place that places an order), `lastOrder` (this tab) |
| `purchase/PayWindow.tsx` | Paket V: the payment window, 1:1 to the reference recording (`docs/audit/V-VORBILD.md`): card left (front/back, CVC focus flips it, 290 ms), form right, the pay button over the whole column (`.pw-pay`, orbs while handing over to Checkout). Click: form out (100 ms), card flies to the middle (scale 1.08, 300 ms), ring „Autorisierung bei deiner Bank“; „Bezahlt“ / „Testphase läuft“ ONLY after `billing-status` (webhook) confirms; an error turns the card back and names the field **Auftritt / Ausgang (Runde 13):** Abdunklung und Rahmen blenden ein, Kopf, Karte, Bestellung und Formular steigen 45 ms nacheinander ein (`pay/payWindow.css`, `pw-in-*`, nur `backwards`); beim Schließen blendet das Fenster auf `tween.exitSurface` aus, erst dann schließt die Bestellung (`close`). Auf dem Handy ist das Schließen-✕ dunkle Tinte auf dem Papierkopf. |
| `purchase/pay/fields.ts`, `stripeFields.ts`, `demoFields.ts` | the card-field adapter: **Stripe Elements** (`cardNumber` / `cardExpiry` / `cardCvc` in Stripe's iframes, `@stripe/stripe-js/pure`, loaded lazily) – the card number never reaches our code, we only see `brand`, `empty`, `complete`, `error`. `demoFields` only in dev / showroom (marked „Demo ohne Zahlung“, posts only a verdict) |
| `purchase/pay/payFlow.ts`, `payMotion.ts`, `PayCard.tsx` | the order in the app: `billing-subscribe` → `confirmCardSetup` (trial) / `confirmCardPayment` (3-D Secure in Stripe's own frame) → `/complete` → poll `billing-status`; the stage choreography (Web Animations, ids `pay:*`); the card face (brand, „••••“ groups by empty/complete, holder falls in) |
| `purchase/PlanCardArt.tsx` | Paket B: the plan **card illustration** of the RESULT page (plan · interval · seats · amount) – NOT a card form, no card data; the success glow (`tone="confirmed"`) only for the server-confirmed state |
| `ctas.ts` | Paket B: `planCta` – the words and the clickability of every plan card / hero / detail / upgrade CTA in one pure function (`Kostenlos starten`, `<Plan> auswählen`, `Weiter zur Zahlung`, `Dein aktueller Tarif` (a status, not a button), `Zu <Plan> wechseln` / `Tarif ändern`) |
| `purchase/ManageSheet.tsx`, `manage.ts` | Konto › „Abo verwalten“: facts, Stripe portal (payment method, invoices, switch month ↔ year, seats), „Verträge hier kündigen“, „Vertrag widerrufen“ (only in the first 14 days) |
| `purchase/purchase.css` | glass surface `.pay-glass` / `.pay-sheet` (88–94 % opaque, fallback without `backdrop-filter` and under `data-safe-fx`), `.pay-orbs`, `.pay-swap` |
| `ui/ContractSheet.tsx`, `ui/ContractHost.tsx`, `contractStore.ts` | „Verträge hier kündigen“ / „Vertrag widerrufen“ WITHOUT a login: form → confirmation page → receipt → link of the e-mail (`/?kuendigen[=token]`, `/?widerruf[=token]`) |
| `planChange.ts` | the hook „the SERVER confirmed another plan“: `onPlanChange(({ to }) => setMotionTier(to))` – the motion package registers; nothing happens without it |
| `src/legal/consentRecord.ts` | the two consent wordings, version, SHA-256 (client and server hash the same bytes), order id |

Server: `billing-subscribe` (Paket V: needs `VITE_STRIPE_PUBLISHABLE_KEY` in the client and Stripe Tax OFF, else 409 `embedded_unavailable` → Checkout; trial → SetupIntent, the subscription is created only after the card is confirmed (`/complete` or webhook `setup_intent.succeeded`); without trial → subscription `default_incomplete`, the `client_secret` of its first invoice back; same consent evidence and idempotency as Checkout), `billing-checkout` (locked while Stripe OR the operator's legal texts are missing → `purchase_closed`; both consents + current wording or 422 / 409; evidence in `consents` BEFORE the session, fail-closed; Stripe idempotency key `tj-checkout-<user>-<order>`; success / cancel URLs same origin only; `submit_type: pay` + `custom_text.submit`), `billing-contract` (+ `/confirm`; `_lib/contractRequest.ts`, `_lib/contractMail.ts`), `billing-portal` (cancel records and mails the confirmation; `feedback` = the reason AFTER the confirmation), `_lib/purchase.ts`. Migration `0016_consents.sql`. Tests: `billing.purchase.order.test.ts`, `billing.purchase.ui.test.tsx`, `purchase.functions.test.ts` (fake Stripe, no network), `supabase.consents.test.ts`, e2e `kaufstrecke.spec.ts`. Checked only against fakes: a real Stripe account, the real webhook delivery, the real Resend mail.
