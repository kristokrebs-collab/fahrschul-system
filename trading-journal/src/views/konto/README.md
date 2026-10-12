# `src/views/konto` – Konto page (P09 base)

`KontoView({ extraCards? })` – `h1 Konto` (PageHeader + LeadFill `<prefix>fill-konto`, key word `Local-first`), then one
grid (`lg:grid-cols-12`, cells blur-fade in with `Reveal`, spans on the cells):

| state | cells |
|---|---|
| no cloud (file build, `file://`, claude.ai, missing env) | `CloudUnavailableCard` (12) |
| signed out | `AuthCard` (7) · `PrivacyCard` (5) |
| signed in | `AuthCard` (5) · `SyncStatusCard` (7) · `SecurityCard` (7) · `PrivacyCard` (5) · `AccountDataCard` (12) |

`extraCards` is the slot for P10 (`PlanCard`, `BillingCard`) and P11 (`ExchangeConnectionsCard`, `SyncInbox`) – P14 composes
the final page. The account pill is NOT on this page (one `auth-sheet` layoutId source on screen: the header's).
The cards live in `src/cloud/ui` (see `src/cloud/README.md`).

Until P14 registers the page, `/dev/konto.html` (vite dev) renders it with the real hosts; `tests/e2e/cloud.spec.ts` uses
the harness (`PW_KONTO_URL=/#konto` once routed).
