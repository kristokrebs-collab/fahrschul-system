# `src/views/preise` – pricing page (P10)

`PreiseView()` – `h1 Preise` (shared `PageHeader`, LeadFill key `<prefix>fill-preise`, key word "jederzeit kündbar"), then:

| block | file | effects |
|---|---|---|
| honest notices | `@/billing/ui/parts` `ClosedNotice`, `RefBanner` | clip wipe; an invitation (`?ref=`) gets one `SpotlightSweep` |
| hero | `PricingHero.tsx` | `LaunchGrid` stage: radial dot field, `AsciiCascade` "PRO", slot Gefühl → FOMO → Zufall → System, equity-card wall collapsing onto the A+ curve, Pro price panel, trial line + CTA (≈ 4 s, then rest) |
| Monat / Jahr | `PreiseView.tsx` `IntervalToggle` | `Segmented`; the yearly label carries the real saving |
| plan cards | `PlanGrid.tsx` | dealt in (`CardSpread deal`), each in a `NotchedFrame` (art grey → colour on hover), prices on `RollingDigits` under a `TextPrism` lens, ONE `BorderBeam` lap on the recommended plan once in view, highlight ticks draw in; a valid code decodes the new price (`TextScramble`) with a green `ValueFlash`; team seat stepper |
| promotion code | `CodeField.tsx` | server-checked preview; invalid → `Field` shake + reason; valid → terms decode in |
| stats band | `StatsMarquee.tsx` | `Marquee` – true-by-construction facts + the visitor's own trade count, nothing invented |
| comparison | `PlanComparison.tsx` | the full `plans.ts` matrix + quotas, **grouped by the goals of a trader** (same names as the tiles of the page „Funktionen“) and **foldable** (A1): the first group open, the others a frosted header row of fixed height each (no layout jump while closed), „Alle aufklappen“; cells of an opened group cascade from the recommended column (`HeatGridReveal`), ticks draw; one visually hidden real `<table>` with EVERY row for screen readers, the animated grid is `aria-hidden`. Quotas of functions that are not built yet (`LIMIT_INFO.state = "geplant"`) stay out. No purchase flow here (B4) |
| FAQ | `PricingFaq.tsx` | rows cascade (`RevealGroup`), answers `Collapse`, `+` turns 45° |
| legal line | `PreiseView.tsx` `LegalLine` | "Verträge hier kündigen" → `CancelSheet` (signed out: login first) |

Every CTA is real: Checkout redirect, login first when signed out, portal for an existing abo, or an honest line
("Noch nicht buchbar", "Dein Tarif"). Works in all billing modes (see `src/billing/README.md`).

Wiring (P14): register `preise` (PAGES, key `p`, …) with `React.lazy(() => import("@/views/preise"))` and mount
`BillingHost` once in `App`. Until then: dev harness `dev/preise.html` (`#preise` / `#konto`, `?cloud=off`) on the Vite
dev server; e2e `tests/e2e/preise.spec.ts` (`PW_PREISE_URL=/#preise`, `PW_KONTO_URL=/#konto` once routed).

## Feinschliff Runde 8

- Seitenraster `gap-5` wie alle Seiten (vorher `gap-6`), der Lead ist sprachlich geklärt („Starte kostenlos und wechsle erst, wenn du mehr aus deinem Journal holen willst – jederzeit kündbar.“).
- Angemeldet (Abo-Modus offen): „Siehe auch“ unter den Tarifen – Konto und Abo verwalten · Freunde einladen (Preise ↔ Konto).

## Runde 10 (Agent 7)

Die Pillen „Empfohlen“, „Aktueller Tarif“ und „Dein Tarif“ schweben 2 px (`Float`, pausiert ausserhalb des Bildschirms). Geisterwort „Wahl“. Hero, Deal, Prisma, Randlicht und Zaehler waren schon da und bleiben.

## Kaufstrecke (B4)

`PlanGrid` (glass cards; „Weiter zur Bestellung“ and „Tarif im Detail“ – never an order button), `PricingHero`, `PreiseView` (toggle label „Jährlich −X %“ only from the shown prices, `PRICE_TAX_NOTE` in the legal line, „Verträge hier kündigen“ opens the public page without a login) and `ResultView.tsx` (the five states after Stripe, mounted by `src/billing/purchase/PurchaseHost`). The order itself: `src/billing/purchase/` (see the billing README).

`IntervalToggle`, `LegalLine`, `PlanGrid`, `PlanComparison`, `PricingFaq` and `StatsMarquee` are also the plan part of the landing page of a first visit (`src/app/gate/Landing.tsx`, `gate: "landing"`): one set of cards and buttons, so a price or a button's wording can never differ between the two pages. `StatsMarquee` measures its own box – its parent must be a column that may shrink (`min-w-0` / `minmax(0, 1fr)`), otherwise the band widens the page with every copy it adds.
