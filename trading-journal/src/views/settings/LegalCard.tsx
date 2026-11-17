/**
 * `Rechtliches` card of the settings page: the full list of the legal documents of this build (Impressum, Datenschutz,
 * AGB, Widerruf, Hinweise with Risiko / Preise / Partnerlinks / Marken), each with its HONEST status – the operator's own
 * page, the operator data, an in-app DRAFT („Entwurf – Prüfung durch Anwalt nötig“) or a marked placeholder – and a
 * button that opens it in the legal sheet (`openLegal`). Below: what the app stores in the browser (no cookies, no
 * trackers) and the one-sentence risk notice. It claims no compliance; the texts are drafts (docs/RECHT/). Not shown
 * inside claude.ai (nothing is sold there).
 */
import { memo } from "react";
import { LEGAL_LABEL, impressumComplete, legalConfig, legalShown, type LegalConfig, type LegalPage } from "@/legal/config";
import { RISK_SHORT } from "@/legal/consentTexts";
import { openLegal } from "@/legal/store";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";

export const LEGAL_CARD = {
  title: "Rechtliches",
  note: "Impressum, Datenschutz, AGB, Widerruf und Hinweise – und was davon noch fehlt",
  open: "Öffnen",
  storageTitle: "Was die App im Browser speichert",
  storage:
    "Dein Journal, deine Einstellungen und die Anmeldung liegen im Speicher deines Browsers (Local Storage, IndexedDB). Das ist technisch nötig, damit das Journal funktioniert. Die App setzt keine Cookies und keine Tracker und lädt keine Schriftarten oder Skripte von fremden Servern.",
  status: {
    own: "Eigene Seite des Betreibers",
    data: "Aus den Betreiberdaten",
    missingData: "Platzhalter – Angaben fehlen",
    inAgb: "Steht in den AGB des Betreibers",
    draft: "Entwurf – Prüfung durch Anwalt nötig",
    reviewed: "Text in der App – vom Betreiber als geprüft erklärt",
  },
  hint: {
    impressum: "Anbieter, Anschrift, Kontakt",
    datenschutz: "Wie mit deinen Daten umgegangen wird",
    agb: "Leistung, Laufzeit, Kündigung, Haftung",
    widerruf: "Belehrung, Muster-Formular",
    hinweise: "Risiko, Preise und Steuern, Partnerlinks, Marken",
  },
} as const;

const PAGES: readonly LegalPage[] = ["impressum", "datenschutz", "agb", "widerruf", "hinweise"];

/** The status text of one page for this config (pure, tested). */
export function legalStatus(page: LegalPage, c: LegalConfig): { text: string; tone: "ok" | "warn" } {
  const S = LEGAL_CARD.status;
  if (page === "impressum") {
    if (c.urls.impressum) return { text: S.own, tone: "ok" };
    return impressumComplete(c) ? { text: S.data, tone: "ok" } : { text: S.missingData, tone: "warn" };
  }
  if (page !== "hinweise" && c.urls[page]) return { text: S.own, tone: "ok" };
  if (page === "widerruf" && c.urls.agb) return { text: S.inAgb, tone: "ok" };
  return c.draftsReviewed ? { text: S.reviewed, tone: "ok" } : { text: S.draft, tone: "warn" };
}

export const LegalCard = memo(function LegalCard({ className }: { className?: string }) {
  if (!legalShown()) return null;
  const c = legalConfig();
  return (
    <Card title={LEGAL_CARD.title} note={LEGAL_CARD.note} className={className} data-testid="settings-legal-card">
      <ul className="grid gap-2.5 sm:grid-cols-2" aria-label={LEGAL_CARD.title}>
        {PAGES.map((p) => {
          const st = legalStatus(p, c);
          return (
            <li key={p} className="flex min-w-0 items-center gap-3 rounded-xl border border-line bg-ink-950/40 px-3.5 py-3" data-testid={`settings-legal-${p}`} data-tone={st.tone}>
              <span className="grid min-w-0 flex-1 gap-0.5">
                <span className="text-[13.5px] font-medium text-fg">{LEGAL_LABEL[p]}</span>
                <span className="truncate text-[12px] text-mute">{LEGAL_CARD.hint[p]}</span>
                <span className={st.tone === "warn" ? "text-[11.5px] font-medium text-warn" : "text-[11.5px] text-mute"}>{st.text}</span>
              </span>
              <Button size="sm" onClick={() => openLegal(p)} aria-label={`${LEGAL_LABEL[p]} ${LEGAL_CARD.open}`}>
                {LEGAL_CARD.open}
              </Button>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 grid gap-1.5 border-t border-line pt-4">
        <span className="label !text-[9.5px]">{LEGAL_CARD.storageTitle}</span>
        <p className="max-w-[72ch] text-[12.5px] leading-relaxed text-mute" data-testid="settings-legal-storage">
          {LEGAL_CARD.storage}
        </p>
        <p className="max-w-[72ch] text-[12.5px] leading-relaxed text-mute" data-testid="settings-legal-risk">
          {RISK_SHORT}
        </p>
      </div>
    </Card>
  );
});
