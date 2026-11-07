# `src/legal` – Rechtliches (Review F07, Paket G)

The app never invents an operator, an address, a tax id or legal wording as FINAL text. Operator data comes from the build env
(`VITE_LEGAL_*`, SETUP.md 4.2, `docs/ENV.md`); whatever is missing is a clearly marked placeholder („Platzhalter – vom Betreiber
auszufüllen: VITE_LEGAL_…“). The drafts of the documents live in `docs/RECHT/*.md` (ONE copy, read with `?raw`) and are always marked
„Entwurf – Prüfung durch Anwalt nötig“ – nothing here claims compliance. Status and open questions: `docs/RECHT-CHECKLISTE.md`.

| file | contents |
|---|---|
| `config.ts` | `legalConfigOf(env)` / `legalConfig()` (typed: operator, address lines, e-mail, phone, representative, register, VAT id, responsible person, URLs of Impressum / Datenschutz / AGB / Widerruf – https or a same-site path only, `draftsReviewed`), `LEGAL_ENV_VARS` (the one list of variable names), `LEGAL_PAGES` (the four documents + „Hinweise“), `impressumComplete`, `legalComplete` (only operator pages/data count – a draft never makes it „complete“), `missingLegal`, `legalShown()` (not inside claude.ai: nothing is sold there), deep link `?rechtliches=<page>` |
| `store.ts` | `useLegal` (open page, loaded), `openLegal`, `closeLegal` |
| `LegalLinks.tsx` | `LegalLink` (operator URL → new tab; else the in-app sheet, still a real `?rechtliches=` link) and the row Impressum · Datenschutz · AGB · Widerruf · Hinweise – Konto and Preise. `extended={false}` (shell footer and narrow sidebar) keeps Impressum · Datenschutz · AGB (· Widerruf with an operator page): five links would wrap on a phone and change the Übersicht's footer (measured: +44 px) |
| `LegalSheet.tsx` | lazy sheet: Impressum from the operator data; Datenschutz / AGB / Widerruf as the operator's page (button) or – without one – the marked placeholder PLUS the in-app draft; „Hinweise“ always the in-app text; `Segmented` switch |
| `LegalDocument.tsx` | one draft page: loads the Markdown on demand, the „Entwurf“ bar (gone only with `VITE_LEGAL_DRAFTS_REVIEWED=true`), reserved height while loading |
| `markdown.tsx` | the small Markdown of the drafts as React nodes (never HTML): headings, lists, quotes, bold, safe links; `{{VITE_LEGAL_…}}` = operator value or marked placeholder, `{{TODO: …}}` = always a marked placeholder; `> **[ANWALT]**` notes are dropped |
| `texts.ts` | lazy loaders of `docs/RECHT/*.md` (`?raw`, one chunk per file, never in the first load); „Hinweise“ = Risikohinweis + Preise + Partnerlinks + Marken |
| `consentTexts.ts` | wordings the drafts quote and the purchase flow still has to use: `IMMEDIATE_START_CONSENT`, `PARTNER_LINK_LABEL`, `BUTTON_LABELS` (§ 312j / § 312k / § 356a), `PRICE_TAX_NOTE`, `RISK_SHORT`, `DRAFT_NOTICE` – wired into the purchase flow since B4 (`src/billing/purchase/`); `BUTTON_LABELS.order` is now exactly „Zahlungspflichtig bestellen“ |
| `consentRecord.ts` | the two consents of the order (`terms`, `immediate_start`) as data: wording, version, SHA-256, order id – shared by the order sheet and the server (evidence in `consents`, migration 0016) |
| `LegalHost.tsx` | leaf host in `App` (HostSlot „Rechtliches“): reads `?rechtliches=` once, removes it from the address bar, mounts the sheet on demand |
| `ConsentCheck.tsx` | required checkbox (native input) with document links in its label: sign-up (`AuthSheet`) and before every Stripe checkout (`UpgradeSheet`; `startCheckout` routes through the sheet until `termsAccepted`) |

Settings: `src/views/settings/LegalCard.tsx` („Rechtliches“, Group „Aussehen und Hilfe“) lists the five pages with their honest status.
Tests: `tests/unit/legal.test.tsx` (config, sheet, card), `tests/unit/legal.drafts.test.tsx` (variables, placeholders, links, wordings).
