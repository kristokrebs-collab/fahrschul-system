/**
 * Legal data of the operator (Review F07): Impressum, Datenschutzerklärung, AGB and Widerrufsbelehrung. The app never
 * invents an operator, an address, a tax id or legal wording – everything comes from the build env (`VITE_LEGAL_*`,
 * set in Netlify; SETUP.md „Rechtliches“). What is missing is shown as a CLEARLY MARKED placeholder, never as text that
 * looks final.
 *
 * - Impressum: rendered in the app from the operator data (or the operator's own page, `VITE_LEGAL_IMPRESSUM_URL`).
 * - Datenschutz / AGB / Widerruf: the operator's own texts, linked by URL (the app does not write legal texts).
 * - Deep link for every document: `/?rechtliches=<doc>` (e.g. Stripe's "Terms of service" URL, e-mails).
 */
import { hasClaudeRuntime } from "@/store/capability";

export const LEGAL_DOCS = ["impressum", "datenschutz", "agb", "widerruf"] as const;
export type LegalDoc = (typeof LEGAL_DOCS)[number];
/** The pages of the legal sheet: the four documents of the operator plus „Hinweise“ (Risiko, Preise & Steuern, Partnerlinks, Marken – no operator URL, always the in-app text). */
export const LEGAL_PAGES = [...LEGAL_DOCS, "hinweise"] as const;
export type LegalPage = (typeof LEGAL_PAGES)[number];

/**
 * Every `VITE_LEGAL_*` variable the app reads. The single list the placeholder names in the draft texts, `.env.example`,
 * `env.d.ts`, SETUP.md and the unit test are checked against.
 */
export const LEGAL_ENV_VARS = [
  "VITE_LEGAL_OPERATOR",
  "VITE_LEGAL_ADDRESS",
  "VITE_LEGAL_EMAIL",
  "VITE_LEGAL_PHONE",
  "VITE_LEGAL_REPRESENTATIVE",
  "VITE_LEGAL_REGISTER",
  "VITE_LEGAL_VAT_ID",
  "VITE_LEGAL_RESPONSIBLE",
  "VITE_LEGAL_IMPRESSUM_URL",
  "VITE_LEGAL_DATENSCHUTZ_URL",
  "VITE_LEGAL_AGB_URL",
  "VITE_LEGAL_WIDERRUF_URL",
  "VITE_LEGAL_DRAFTS_REVIEWED",
] as const;
export type LegalEnvVar = (typeof LEGAL_ENV_VARS)[number];

export interface LegalConfig {
  /** Name / company of the operator */
  operator: string | null;
  /** postal address; lines separated by "|" or a line break */
  address: string[];
  email: string | null;
  phone: string | null;
  /** legal representative (e.g. Geschäftsführer) */
  representative: string | null;
  /** register court and number */
  register: string | null;
  vatId: string | null;
  /** person responsible for the content */
  responsible: string | null;
  urls: Readonly<Record<LegalDoc, string | null>>;
  /**
   * The operator states that the in-app draft texts (`docs/RECHT/`) were reviewed by a lawyer (`VITE_LEGAL_DRAFTS_REVIEWED=true`):
   * only then the „Entwurf“ bar over them is gone. The app checks nothing – it is the operator's own declaration.
   */
  draftsReviewed: boolean;
}

type Env = Partial<Record<string, string | undefined>>;

const text = (v: string | undefined): string | null => {
  const t = (v ?? "").trim();
  return t ? t.slice(0, 400) : null;
};

/** Only https links (or a same-site path) are accepted – a typo never becomes a `javascript:` link. */
export function safeLegalUrl(v: string | undefined): string | null {
  const t = (v ?? "").trim();
  if (!t) return null;
  if (t.startsWith("/") && !t.startsWith("//")) return t;
  try {
    const u = new URL(t);
    return u.protocol === "https:" ? u.toString() : null;
  } catch {
    return null;
  }
}

/** Reads the config from an env object (pure – tests pass their own). */
export function legalConfigOf(env: Env): LegalConfig {
  return {
    operator: text(env.VITE_LEGAL_OPERATOR),
    address: (env.VITE_LEGAL_ADDRESS ?? "")
      .split(/\||\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(0, 6),
    email: text(env.VITE_LEGAL_EMAIL),
    phone: text(env.VITE_LEGAL_PHONE),
    representative: text(env.VITE_LEGAL_REPRESENTATIVE),
    register: text(env.VITE_LEGAL_REGISTER),
    vatId: text(env.VITE_LEGAL_VAT_ID),
    responsible: text(env.VITE_LEGAL_RESPONSIBLE),
    urls: {
      impressum: safeLegalUrl(env.VITE_LEGAL_IMPRESSUM_URL),
      datenschutz: safeLegalUrl(env.VITE_LEGAL_DATENSCHUTZ_URL),
      agb: safeLegalUrl(env.VITE_LEGAL_AGB_URL),
      widerruf: safeLegalUrl(env.VITE_LEGAL_WIDERRUF_URL),
    },
    draftsReviewed: (env.VITE_LEGAL_DRAFTS_REVIEWED ?? "").trim().toLowerCase() === "true",
  };
}

let cached: LegalConfig | null = null;
/** The config of this build. */
export function legalConfig(): LegalConfig {
  return (cached ??= legalConfigOf(import.meta.env as unknown as Env));
}

/** Tests: pin a config (`null` = back to the build env). */
export function setLegalConfigForTests(c: LegalConfig | null): void {
  cached = c;
}

/** The Impressum can be shown: the operator's own page, or name + address + e-mail. */
export const impressumComplete = (c: LegalConfig): boolean => !!c.urls.impressum || (!!c.operator && c.address.length > 0 && !!c.email);

/** Every document a sold deployment needs is there (Impressum, Datenschutz, AGB; Widerruf may live in the AGB). */
export const legalComplete = (c: LegalConfig): boolean => impressumComplete(c) && !!c.urls.datenschutz && !!c.urls.agb;

/** What is still missing, as the env names the operator has to set (SETUP.md). */
export function missingLegal(c: LegalConfig): string[] {
  const out: string[] = [];
  if (!impressumComplete(c)) {
    if (!c.operator) out.push("VITE_LEGAL_OPERATOR");
    if (!c.address.length) out.push("VITE_LEGAL_ADDRESS");
    if (!c.email) out.push("VITE_LEGAL_EMAIL");
  }
  if (!c.urls.datenschutz) out.push("VITE_LEGAL_DATENSCHUTZ_URL");
  if (!c.urls.agb) out.push("VITE_LEGAL_AGB_URL");
  return out;
}

/**
 * Legal links are part of every web deployment – but not of the personal journal inside claude.ai (the artifact
 * runtime: nothing is sold there, PR #3 stays as it was).
 */
export function legalShown(): boolean {
  return !hasClaudeRuntime();
}

export const LEGAL_LABEL: Readonly<Record<LegalPage, string>> = {
  impressum: "Impressum",
  datenschutz: "Datenschutz",
  agb: "AGB",
  widerruf: "Widerruf",
  hinweise: "Hinweise",
};

/** Deep link of a document inside the app. */
export const legalDeepLink = (doc: LegalPage): string => `?rechtliches=${doc}`;

/** The document a URL asks for (`?rechtliches=impressum`), or null. */
export function legalDocOfUrl(href: string): LegalPage | null {
  try {
    const v = new URL(href).searchParams.get("rechtliches");
    return v && (LEGAL_PAGES as readonly string[]).includes(v) ? (v as LegalPage) : null;
  } catch {
    return null;
  }
}
