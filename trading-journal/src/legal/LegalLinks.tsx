/**
 * The legal links row (Review F07): Impressum · Datenschutz · AGB (· Widerruf when the operator has its own page). A
 * document with an operator URL opens that page (new tab); otherwise the in-app sheet (`?rechtliches=<doc>` stays a
 * real link: open in a new tab works). Hidden inside claude.ai (nothing is sold there).
 */
import type { MouseEvent } from "react";
import { cn } from "@/lib/cn";
import { LEGAL_LABEL, legalConfig, legalDeepLink, legalShown, type LegalDoc } from "./config";
import { openLegal } from "./store";

export function LegalLink({ doc, className, children }: { doc: LegalDoc; className?: string; children?: React.ReactNode }) {
  const url = legalConfig().urls[doc];
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

export function LegalLinks({ className, roomy = false }: { className?: string; roomy?: boolean }) {
  if (!legalShown()) return null;
  const docs: LegalDoc[] = ["impressum", "datenschutz", "agb"];
  if (legalConfig().urls.widerruf) docs.push("widerruf");
  // `roomy` (menu, sidebar): every link is its own 44 px tall box with padding on both sides – the tap areas never overlap
  if (roomy)
    return (
      <nav aria-label="Rechtliches" className={cn("flex flex-wrap items-center text-[11.5px] text-mute", className)} data-testid="legal-links">
        {docs.map((d) => (
          <LegalLink key={d} doc={d} className="inline-flex min-h-tap items-center px-2.5" />
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
    </nav>
  );
}
