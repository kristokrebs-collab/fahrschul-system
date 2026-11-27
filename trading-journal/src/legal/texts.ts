/**
 * The draft texts (`docs/RECHT/*.md`) as lazily loaded raw text – ONE copy, the files themselves. Each loader is its own
 * chunk (`import("….md?raw")`), fetched when a document is opened, never part of the first load.
 * `hinweise` is four files in one: Risikohinweis, Preise & Steuern, Partnerlinks, Marken. `impressum` is the template of
 * the Impressum (the sheet itself renders the Impressum from the operator data, not from this file).
 */
import type { LegalPage } from "./config";

type Loader = () => Promise<{ default: string }>;

export const LEGAL_SOURCES: Readonly<Record<LegalPage, readonly Loader[]>> = {
  impressum: [() => import("../../docs/RECHT/impressum.md?raw")],
  datenschutz: [() => import("../../docs/RECHT/datenschutz.md?raw")],
  agb: [() => import("../../docs/RECHT/agb.md?raw")],
  widerruf: [() => import("../../docs/RECHT/widerruf.md?raw")],
  hinweise: [
    () => import("../../docs/RECHT/risikohinweis.md?raw"),
    () => import("../../docs/RECHT/preisangaben.md?raw"),
    () => import("../../docs/RECHT/partnerlinks.md?raw"),
    () => import("../../docs/RECHT/marken.md?raw"),
  ],
};

/** The Markdown source of a page (the files of „Hinweise“ joined by a blank line). */
export async function loadLegalSource(page: LegalPage): Promise<string> {
  const parts = await Promise.all(LEGAL_SOURCES[page].map((load) => load().then((m) => m.default)));
  return parts.join("\n\n");
}
