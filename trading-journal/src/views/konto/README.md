# `src/views/konto` – Konto page (P09 base)

`KontoView({ extraCards? })` – `h1 Konto` (PageHeader + LeadFill `<prefix>fill-konto`, key word `Local-first`), then one
grid (`lg:grid-cols-12`, cells blur-fade in with `Reveal`, spans on the cells):

| state | cells |
|---|---|
| no cloud (file build, `file://`, claude.ai, missing env) | `CloudUnavailableCard` (12) |
| signed out | `AuthCard` (7) · `PrivacyCard` (5) |
| signed in | `AuthCard` (5) · `SyncStatusCard` (7) · `SecurityCard` (7) · `PrivacyCard` (5) · `AccountDataCard` (12) |

`extraCards` is the slot for P10 (`PlanCard`, `BillingCard`) and P11 (`ExchangeConnectionsCard`, `SyncInbox`). The account
pill is NOT on this page (one `auth-sheet` layoutId source on screen: the header's). The cards live in `src/cloud/ui` (see
`src/cloud/README.md`).

**The routed page (P14): `KontoPage.tsx`** (lazy chunk of page `konto`) = `KontoView` with, only where this build has a
cloud (`cloudEnabled() && !hasClaudeRuntime()`), the extra cells: `PlanCard` (usage: saved views, dashboards) ·
`BillingCard` · `ReferralCard` (payments open and signed in) · `ExchangeSection` (P11 cells; the app-level `ExchangeHost`
owns the sheets, so `withHost={false}`). Without cloud the page is `CloudUnavailableCard` alone – honest, nothing invented.
The e2e specs (`cloud.spec.ts`, `preise.spec.ts`, `exchange.spec.ts`) run on `/#konto` of the cloud edition of the
production build (Supabase mock); `/dev/konto.html` stays for manual work under `npm run dev`.
