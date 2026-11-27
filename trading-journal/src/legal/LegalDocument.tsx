/**
 * One in-app legal document (`docs/RECHT/<doc>.md`) as a page of the legal sheet: the draft text, loaded on demand,
 * with the „Entwurf – Prüfung durch Anwalt nötig“ bar over it until the operator declares the texts reviewed
 * (`VITE_LEGAL_DRAFTS_REVIEWED=true`). Placeholders inside the text are marked (`markdown.tsx`). The sheet's body has a
 * reserved minimum height while the file loads, so nothing jumps.
 */
import { useEffect, useState } from "react";
import type { LegalConfig, LegalPage } from "./config";
import { DRAFT_NOTICE } from "./consentTexts";
import { LegalMarkdown } from "./markdown";
import { loadLegalSource } from "./texts";

export function DraftBar({ config }: { config: LegalConfig }) {
  if (config.draftsReviewed) return null;
  return (
    <div className="grid gap-0.5 rounded-xl border border-dashed border-warn/50 bg-warn/[0.06] px-3 py-2 text-[12px] text-warn" role="note" data-testid="legal-draft-bar">
      <span className="text-[10px] font-semibold uppercase tracking-[0.14em]">{DRAFT_NOTICE.title}</span>
      <span>{DRAFT_NOTICE.text}</span>
    </div>
  );
}

export function LegalDocument({ page, config }: { page: LegalPage; config: LegalConfig }) {
  const [state, setState] = useState<{ page: LegalPage; source: string | null; failed: boolean } | null>(null);
  useEffect(() => {
    let live = true;
    loadLegalSource(page).then(
      (source) => live && setState({ page, source, failed: false }),
      () => live && setState({ page, source: null, failed: true }),
    );
    return () => {
      live = false;
    };
  }, [page]);
  const mine = state?.page === page ? state : null;
  return (
    <div className="grid min-h-[40vh] content-start gap-4" data-testid="legal-document" data-page={page}>
      <DraftBar config={config} />
      {mine?.source ? (
        <LegalMarkdown source={mine.source} config={config} />
      ) : mine?.failed ? (
        <p className="text-[13px] text-loss" role="alert">
          Der Text konnte nicht geladen werden. Bitte lade die Seite neu.
        </p>
      ) : (
        <p className="text-[13px] text-mute" aria-live="polite">
          Lädt …
        </p>
      )}
    </div>
  );
}
