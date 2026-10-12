import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { useCloudSession } from "@/cloud/session";
import { Reveal } from "@/motion/Reveal";
import { ExchangeHost } from "./ExchangeHost";
import { exchangeEnabled, primaryConnection, useExchange } from "./store";
import { ApiAccessCard } from "./ui/ApiAccessCard";
import { ExchangeConnectionsCard } from "./ui/ExchangeConnectionsCard";
import { ReconcileCard } from "./ui/ReconcileCard";
import { SyncInbox } from "./ui/SyncInbox";

function Cell({ index, span, children }: { index: number; span: string; children: ReactNode }) {
  return (
    <Reveal index={index} className={cn("min-w-0", span)}>
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
 * The exchange cells for `KontoView extraCards` (P11): Börse (connect / sync), Zu prüfen (inbox), Broker-Abgleich and
 * API & Webhooks – each a 12-column grid cell with the reveal cascade. The inbox and the reconciliation show once
 * something was imported; API & Webhooks only for signed-in users. Renders nothing without cloud.
 */
export function ExchangeSection({ startIndex = 5, withHost = true }: ExchangeSectionProps) {
  const enabled = exchangeEnabled();
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const connected = useExchange((s) => !!primaryConnection(s.status));
  if (!enabled) return withHost ? <ExchangeHost /> : null;
  return (
    <>
      <Cell index={startIndex} span="lg:col-span-7">
        <ExchangeConnectionsCard />
      </Cell>
      {signedIn && (
        <Cell index={startIndex + 1} span="lg:col-span-5">
          <SyncInbox />
        </Cell>
      )}
      {signedIn && connected && (
        <Cell index={startIndex + 2} span="lg:col-span-7">
          <ReconcileCard />
        </Cell>
      )}
      {signedIn && (
        <Cell index={startIndex + 3} span={connected ? "lg:col-span-5" : "lg:col-span-12"}>
          <ApiAccessCard />
        </Cell>
      )}
      {withHost && <ExchangeHost />}
    </>
  );
}
