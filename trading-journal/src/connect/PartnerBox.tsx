import { partnerLink, type PartnerId } from "./partners";
import { PARTNER } from "./strings";

/**
 * "Noch kein Konto?" with a clearly marked partner link – rendered ONLY when the operator set a link for this partner in
 * the build environment (`VITE_PARTNER_*_REF`); otherwise nothing at all. The mark is always visible next to the link,
 * the anchor is `rel="sponsored noopener noreferrer"`, nothing about the user is added to the link.
 */
export function PartnerBox({ partner, env }: { partner: PartnerId; env?: Record<string, string | undefined> }) {
  const link = partnerLink(partner, env);
  if (!link) return null;
  return (
    <div className="cx-partner grid gap-1.5" data-testid="partner-box" data-partner={partner}>
      <span className="label">{PARTNER.title}</span>
      <a
        href={link.href}
        target="_blank"
        rel={link.rel}
        className="inline-flex min-h-11 items-center gap-1.5 text-[13px] font-medium text-fg underline decoration-line-2 underline-offset-4 hover:decoration-fg"
        data-testid="partner-link"
      >
        {PARTNER.go(link.name)}
        <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
          <path d="M6 3h7v7M13 3 4 12" />
        </svg>
      </a>
      <span className="text-[11.5px] leading-snug text-mute" data-testid="partner-notice">
        {link.notice}
      </span>
    </div>
  );
}
