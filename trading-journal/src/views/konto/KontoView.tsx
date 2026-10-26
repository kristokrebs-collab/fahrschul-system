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
import { hasClaudeRuntime } from "@/store/capability";
import { storageKey } from "@/store/storage";
import { PageHeader } from "@/views/setups/PageHeader";

export const KONTO_LEAD_FILL = { storageKey: storageKey("fill-konto"), highlight: KONTO.leadHighlight } as const;

export interface KontoViewProps {
  /** Further cards (P10 PlanCard / BillingCard, P11 ExchangeConnectionsCard / SyncInbox) – each a full grid cell. */
  extraCards?: ReactNode;
  /** The page's "Inhalt" strip (signed in only – `KontoPage` knows which cards follow), right under the header. */
  nav?: ReactNode;
  className?: string;
}

/** One grid cell with the reveal cascade; the span sits on the cell, never on the card surface. */
function Cell({ index, span, section, children }: { index: number; span: string; section?: string; children: ReactNode }) {
  return (
    <Reveal index={index} className={cn("min-w-0", span)} data-section={section}>
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
          <Cell index={2} span="lg:col-span-7" section="konto-sicherheit">
            <SecurityCard className="h-full" />
          </Cell>
          <Cell index={3} span="lg:col-span-5">
            <PrivacyCard className="h-full" />
          </Cell>
          <Cell index={4} span="lg:col-span-12" section="konto-daten">
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
