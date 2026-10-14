# `src/legal` – Rechtliches (Review F07)

The app never invents an operator, an address, a tax id or legal wording. Everything comes from the build env
(`VITE_LEGAL_*`, SETUP.md 4.2); whatever is missing is a clearly marked placeholder („Platzhalter – vom Betreiber
auszufüllen: VITE_LEGAL_…“).

| file | contents |
|---|---|
| `config.ts` | `legalConfigOf(env)` / `legalConfig()` (typed: operator, address lines, e-mail, phone, representative, register, VAT id, responsible person, URLs of Impressum / Datenschutz / AGB / Widerruf – https or a same-site path only), `impressumComplete`, `legalComplete`, `missingLegal`, `legalShown()` (not inside claude.ai: nothing is sold there), deep link `?rechtliches=<doc>` |
| `store.ts` | `useLegal` (open document, loaded), `openLegal`, `closeLegal` |
| `LegalLinks.tsx` | `LegalLink` (operator URL → new tab; else the in-app sheet, still a real `?rechtliches=` link) and the row Impressum · Datenschutz · AGB (· Widerruf) – Footer, Konto, Preise |
| `LegalSheet.tsx` | lazy sheet: Impressum from the operator data, the other documents as links; `Segmented` switch |
| `LegalHost.tsx` | leaf host in `App` (HostSlot „Rechtliches“): reads `?rechtliches=` once, removes it from the address bar, mounts the sheet on demand |
| `ConsentCheck.tsx` | required checkbox (native input) with document links in its label: sign-up (`AuthSheet`) and before every Stripe checkout (`UpgradeSheet`; `startCheckout` routes through the sheet until `termsAccepted`) |
