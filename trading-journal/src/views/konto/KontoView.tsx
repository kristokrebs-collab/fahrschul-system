import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";
import { AccountDataCard } from "@/cloud/ui/AccountDataCard";
import { AuthCard } from "@/cloud/ui/AuthCard";
import { CloudUnavailableCard } from "@/cloud/ui/CloudUnavailableCard";
import { PrivacyCard } from "@/cloud/ui/PrivacyCard";
import { SecurityCard } from "@/cloud/ui/SecurityCard";
import { KONTO } from "@/cloud/ui/strings";
import { SyncStatusCard } from "@/cloud/ui/SyncStatusCard";
import { Reveal } from "@/motion/Reveal";
import { RESERVE_CLASS, reserveStyle, type ReserveHeight } from "@/primitives/Reserve";
import { hasClaudeRuntime } from "@/store/capability";
import { storageKey } from "@/store/storage";
import { PageHeader } from "@/views/setups/PageHeader";

/** End sizes (px at 390 / 640 / 1024+) of the signed-in cards that fill late – measured on the finished page. */
const SIZE = {
  security: { base: 721, lg: 656 },
  privacy: { base: 470, lg: 656 },
  data: { base: 718, lg: 364 },
} as const satisfies Record<string, ReserveHeight>;

export const KONTO_LEAD_FILL = { storageKey: storageKey("fill-konto"), highlight: KONTO.leadHighlight } as const;

export interface KontoViewProps {
  /** Further cards (P10 PlanCard / BillingCard, P11 ExchangeConnectionsCard / SyncInbox) – each a full grid cell. */
  extraCards?: ReactNode;
  /** The page's "Inhalt" strip (signed in only – `KontoPage` knows which cards follow), right under the header. */
  nav?: ReactNode;
  className?: string;
}

/**
 * One grid cell with the reveal cascade; the span sits on the cell, never on the card surface. `size`: the END size of a card whose
 * content arrives after the first paint (the device list, the backups) – the cell holds it as a floor from the first frame
 * (`reserveStyle`, `@/primitives/Reserve`), so the cards below never slide down when the data lands.
 */
function Cell({ index, span, section, size, children }: { index: number; span: string; section?: string; size?: ReserveHeight; children: ReactNode }) {
  return (
    <Reveal index={index} className={cn("min-w-0", size && RESERVE_CLASS, span)} style={size ? reserveStyle(size) : undefined} data-section={section}>
      {children}
    </Reveal>
  );
}

/**
 * Konto page (P09 base; P14 adds the billing / exchange cards via `extraCards`): `h1 Konto` with the lead fill, then
 * - no cloud (file build, claude.ai, missing env): one honest card, nothing fake;
 * - signed out: the Login pitch + Datenschutz (telemetry works without an account);
 * - signed in: Login · Sync (top), Sicherheit · Datenschutz, Deine Daten.
 * Cells blur-fade in one after another (`Reveal`, `stagger.reveal`) and end at `transform: none`. The account pill lives
 * in the app header (ONE `auth-sheet` layoutId source on screen), not on this page.
 */
export function KontoView({ extraCards, nav, className }: KontoViewProps) {
  const enabled = cloudEnabled() && !hasClaudeRuntime();
  const phase = useCloudSession((s) => s.phase);
  const signedIn = phase === "signedIn";
  return (
    <div className={cn("grid grid-cols-1 gap-5 lg:grid-cols-12", className)} data-testid="konto-view">
      <PageHeader className="lg:col-span-12" title={KONTO.title} lead={KONTO.lead} leadFill={KONTO_LEAD_FILL} />
      {enabled && signedIn && nav}
      {!enabled ? (
        <Cell index={0} span="lg:col-span-12">
          <CloudUnavailableCard />
        </Cell>
      ) : signedIn ? (
        <>
          <Cell index={0} span="lg:col-span-5" section="konto-login">
            <AuthCard className="h-full" />
          </Cell>
          <Cell index={1} span="lg:col-span-7">
            <SyncStatusCard className="h-full" />
          </Cell>
          <Cell index={2} span="lg:col-span-7" section="konto-sicherheit" size={SIZE.security}>
            <SecurityCard className="h-full" />
          </Cell>
          <Cell index={3} span="lg:col-span-5" size={SIZE.privacy}>
            <PrivacyCard className="h-full" />
          </Cell>
          <Cell index={4} span="lg:col-span-12" section="konto-daten" size={SIZE.data}>
            <AccountDataCard />
          </Cell>
        </>
      ) : (
        <>
          <Cell index={0} span="lg:col-span-7">
            <AuthCard className="h-full" />
          </Cell>
          <Cell index={1} span="lg:col-span-5">
            <PrivacyCard className="h-full" />
          </Cell>
        </>
      )}
      {extraCards}
    </div>
  );
}
