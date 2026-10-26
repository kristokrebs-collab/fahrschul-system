import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useCloudSession } from "@/cloud/session";
import { Reveal } from "@/motion/Reveal";
import { useJournal } from "@/store/journalStore";
import { ExchangeHost } from "./ExchangeHost";
import { isImported } from "./inbox";
import { exchangeEnabled } from "./store";
import { ApiAccessCard } from "./ui/ApiAccessCard";
import { ExchangeConnectionsCard } from "./ui/ExchangeConnectionsCard";
import { ReconcileCard, useReconcileCount } from "./ui/ReconcileCard";
import { SyncInbox } from "./ui/SyncInbox";

function Cell({ index, span, section, children }: { index: number; span: string; section?: string; children: ReactNode }) {
  return (
    <Reveal index={index} className={cn("min-w-0", span)} data-section={section}>
      {children}
    </Reveal>
  );
}

export interface ExchangeSectionProps {
  /** First reveal index (continue the page's cascade, e.g. after the P09 / P10 cards). */
  startIndex?: number;
  /** Mount the fallback host (sheets) here – leave true unless the app-level `ExchangeHost` is guaranteed. */
  withHost?: boolean;
}

/**
 * The exchange cells for `KontoView extraCards` (P11), full 12-column rows:
 * 1. Börse – connect / sync (two columns inside on large screens);
 * 2. Zu prüfen (once something was imported) – next to the Broker-Abgleich while that has open items ("trade the best":
 *    a reconciliation with nothing to do is not shown at all);
 * 3. API & Webhooks (signed in).
 * Renders nothing but the fallback host without cloud (the CSV import still works through it).
 */
export function ExchangeSection({ startIndex = 5, withHost = true }: ExchangeSectionProps) {
  const enabled = exchangeEnabled();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const imported = useJournal((s) => s.trades.some(isImported));
  const recon = useReconcileCount();
  if (!enabled) return withHost ? <ExchangeHost /> : null;
  const showInbox = signedIn && imported;
  const showRecon = signedIn && recon > 0;
  return (
    <>
      <Cell index={startIndex} span="lg:col-span-12" section="konto-boerse">
        <ExchangeConnectionsCard />
      </Cell>
      {showInbox && (
        <Cell index={startIndex + 1} span={showRecon ? "lg:col-span-7 lg:self-start" : "lg:col-span-12"}>
          <SyncInbox columns={showRecon ? 2 : 3} />
        </Cell>
      )}
      {showRecon && (
        <Cell index={startIndex + 2} span={showInbox ? "lg:col-span-5 lg:self-start" : "lg:col-span-12"}>
          <ReconcileCard />
        </Cell>
      )}
      {signedIn && (
        <Cell index={startIndex + 3} span="lg:col-span-12" section="konto-api">
          <ApiAccessCard />
        </Cell>
      )}
      {withHost && <ExchangeHost />}
    </>
  );
}
