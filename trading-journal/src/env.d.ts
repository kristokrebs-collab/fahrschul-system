/**
 * Client build env (Vite inlines `import.meta.env.VITE_*` at build time). PUBLIC values only: anything with the
 * `VITE_` prefix ends up in the bundle – server secrets never get that prefix (see `.env.example`).
 */
interface ImportMetaEnv {
  /** Vite: true in the dev server, false in every build (the demo card fields of the payment window live only behind it). */
  readonly DEV: boolean;
  readonly VITE_SUPABASE_URL?: string;
  readonly VITE_SUPABASE_PUBLISHABLE_KEY?: string;
  /** Paket V: Stripe's PUBLISHABLE key (`pk_test_…` / `pk_live_…`) – the payment window shows Stripe Elements. Without it the order hands over to Stripe Checkout. The secret key stays server-side (`STRIPE_SECRET_KEY`). */
  readonly VITE_STRIPE_PUBLISHABLE_KEY?: string;
  /** Legal data of the operator (`src/legal/config.ts`, SETUP.md „Rechtliches“) – all optional, public. */
  readonly VITE_LEGAL_OPERATOR?: string;
  readonly VITE_LEGAL_ADDRESS?: string;
  readonly VITE_LEGAL_EMAIL?: string;
  readonly VITE_LEGAL_PHONE?: string;
  readonly VITE_LEGAL_REPRESENTATIVE?: string;
  readonly VITE_LEGAL_REGISTER?: string;
  readonly VITE_LEGAL_VAT_ID?: string;
  readonly VITE_LEGAL_RESPONSIBLE?: string;
  readonly VITE_LEGAL_IMPRESSUM_URL?: string;
  readonly VITE_LEGAL_DATENSCHUTZ_URL?: string;
  readonly VITE_LEGAL_AGB_URL?: string;
  readonly VITE_LEGAL_WIDERRUF_URL?: string;
  /** "true" = the operator declares the in-app draft texts (`docs/RECHT/`) reviewed by a lawyer: the „Entwurf“ bar goes away. */
  readonly VITE_LEGAL_DRAFTS_REVIEWED?: string;
}

/** The legal drafts are read as raw text (`src/legal/texts.ts`). */
declare module "*.md?raw" {
  const source: string;
  export default source;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}

/** Showroom switch (Paket S): a Vite `define` (`vite.config.ts`), `false` in every build but the showroom build – see `src/showroom/flag.ts`. */
declare const __TJ_SHOWROOM__: boolean;
