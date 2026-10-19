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
| comparison | `PlanComparison.tsx` | the full `plans.ts` matrix + limits; cells cascade from the recommended column (`HeatGridReveal`), ticks draw; a visually hidden real `<table>` for screen readers, the animated grid is `aria-hidden` |
| FAQ | `PricingFaq.tsx` | rows cascade (`RevealGroup`), answers `Collapse`, `+` turns 45° |
| legal line | `PreiseView.tsx` `LegalLine` | "Verträge hier kündigen" → `CancelSheet` (signed out: login first) |

Every CTA is real: Checkout redirect, login first when signed out, portal for an existing abo, or an honest line
("Noch nicht buchbar", "Dein Tarif"). Works in all billing modes (see `src/billing/README.md`).

Wiring (P14): register `preise` (PAGES, key `p`, …) with `React.lazy(() => import("@/views/preise"))` and mount
`BillingHost` once in `App`. Until then: dev harness `dev/preise.html` (`#preise` / `#konto`, `?cloud=off`) on the Vite
dev server; e2e `tests/e2e/preise.spec.ts` (`PW_PREISE_URL=/#preise`, `PW_KONTO_URL=/#konto` once routed).
