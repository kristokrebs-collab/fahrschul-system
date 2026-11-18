/**
 * The legal links row (Review F07): Impressum · Datenschutz · AGB (· Widerruf when the operator has its own page). A
 * document with an operator URL opens that page (new tab); otherwise the in-app sheet (`?rechtliches=<doc>` stays a
 * real link: open in a new tab works). Hidden inside claude.ai (nothing is sold there).
 */
import type { MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { LEGAL_LABEL, legalConfig, legalDeepLink, legalShown, type LegalPage } from "./config";
import { contractLinksShown, openContract } from "@/billing/contractStore";
import { BUTTON_LABELS } from "./consentTexts";
import { openLegal } from "./store";

/**
 * "Verträge hier kündigen" (§ 312k BGB) / "Vertrag widerrufen" (§ 356a BGB): real links (`?kuendigen`, `?widerruf` – open in a
 * new tab works) that open the contract page, which needs NO login. Only where a contract can exist (`contractLinksShown`).
 */
export function ContractLink({ kind, className }: { kind: "cancel" | "withdraw"; className?: string }) {
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openContract(kind);
  };
  return (
    <a href={kind === "cancel" ? "?kuendigen" : "?widerruf"} onClick={onClick} className={cn("underline-offset-2 hover:text-fg hover:underline", className)} data-testid={`contract-link-${kind}`}>
      {kind === "cancel" ? BUTTON_LABELS.cancel : BUTTON_LABELS.withdraw}
    </a>
  );
}

export function LegalLink({ doc, className, children }: { doc: LegalPage; className?: string; children?: React.ReactNode }) {
  const url = doc === "hinweise" ? null : legalConfig().urls[doc];
  const label = children ?? LEGAL_LABEL[doc];
  if (url && doc !== "impressum")
    return (
      <a href={url} target="_blank" rel="noopener noreferrer" className={cn("underline-offset-2 hover:text-fg hover:underline", className)} data-testid={`legal-${doc}`}>
        {label}
      </a>
    );
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    openLegal(doc);
  };
  return (
    <a href={legalDeepLink(doc)} onClick={onClick} className={cn("underline-offset-2 hover:text-fg hover:underline", className)} data-testid={`legal-${doc}`}>
      {label}
    </a>
  );
}

/**
 * `extended` (default): all five – the Widerrufsbelehrung and the Hinweise (Risiko, Preise, Partnerlinks, Marken) exist in
 * the app as drafts, so they are always one tap away. The narrow sidebar passes `extended={false}`: Impressum ·
 * Datenschutz · AGB (· Widerruf when the operator has a page of its own).
 */
export function LegalLinks({ className, roomy = false, extended = true, contract }: { className?: string; roomy?: boolean; extended?: boolean; contract?: boolean }) {
  if (!legalShown()) return null;
  // the contract links follow `extended` (menu, Konto, Preise); the shell footer asks for the cancel link itself (not on the start page and the cockpit, which keep their pixels)
  const kinds: ("cancel" | "withdraw")[] = !contractLinksShown() ? [] : extended ? ["cancel", "withdraw"] : contract ? ["cancel"] : [];
  const docs: LegalPage[] = ["impressum", "datenschutz", "agb"];
  if (extended) docs.push("widerruf", "hinweise");
  else if (legalConfig().urls.widerruf) docs.push("widerruf");
  // `roomy` (menu, sidebar): every link is its own 44 px tall box with padding on both sides – the tap areas never overlap
  if (roomy)
    return (
      <nav aria-label="Rechtliches" className={cn("flex flex-wrap items-center text-[11.5px] text-mute", className)} data-testid="legal-links">
        {docs.map((d) => (
          <LegalLink key={d} doc={d} className="inline-flex min-h-tap items-center px-2.5" />
        ))}
        {kinds.map((k) => (
          <ContractLink key={k} kind={k} className="inline-flex min-h-tap items-center px-2.5" />
        ))}
      </nav>
    );
  return (
    <nav aria-label="Rechtliches" className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 text-[11.5px] text-mute", className)} data-testid="legal-links">
      {docs.map((d, i) => (
        <span key={d} className="flex items-center gap-3">
          {i > 0 && (
            <span aria-hidden="true" className="text-faint">
              ·
            </span>
          )}
          <LegalLink doc={d} className="touch-hit-links" />
        </span>
      ))}
      {kinds.map((k) => (
        <span key={k} className="flex items-center gap-3">
          <span aria-hidden="true" className="text-faint">
            ·
          </span>
          <ContractLink kind={k} className="touch-hit-links" />
        </span>
      ))}
    </nav>
  );
}
