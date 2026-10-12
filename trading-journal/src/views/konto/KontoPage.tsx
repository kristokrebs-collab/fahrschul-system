/**
 * The Konto page as the app shows it (P14): P09's `KontoView` (login, sync, security, privacy, account data) with the
 * plan / billing / referral cards of P10 and the exchange section of P11 (connections, sync inbox, reconciliation,
 * API tokens & webhooks) in `extraCards`. The cascade continues where the P09 cells stop. Without cloud (file build,
 * claude.ai, no Supabase env) KontoView shows its one honest card and nothing else is added.
 */
import type { ReactNode } from "react";
import { useBillingMode } from "@/billing/store";
import { BillingCard, PlanCard, ReferralCard } from "@/billing/ui";
import { cloudEnabled } from "@/cloud/env";
import { useCloudSession } from "@/cloud/session";
import { ExchangeSection } from "@/exchanges/ExchangeSection";
import { cn } from "@/lib/cn";
import { Reveal } from "@/motion/Reveal";
import { hasClaudeRuntime } from "@/store/capability";
import { navigate } from "@/store/router";
import { useViews } from "@/store/viewsStore";
import { useCockpit } from "@/views/cockpit/cockpitStore";
import { KontoView } from "./KontoView";

function Cell({ index, span, children }: { index: number; span: string; children: ReactNode }) {
  return (
    <Reveal index={index} className={cn("min-w-0", span)}>
      {children}
    </Reveal>
  );
}

/** Reveal index after the P09 cells (signed in: 5 cells, signed out: 2). */
const baseCells = (signedIn: boolean) => (signedIn ? 5 : 2);

function KontoExtras() {
  const signedIn = useCloudSession((s) => s.phase === "signedIn");
  const mode = useBillingMode();
  const savedViews = useViews((s) => s.views.length);
  const dashboards = useCockpit((s) => s.boards.length);
  let index = baseCells(signedIn);
  const billing = mode !== "off";
  const account = mode === "open" && signedIn;
  const cells: ReactNode[] = [];
  if (billing) {
    cells.push(
      <Cell key="plan" index={index++} span={account ? "lg:col-span-7" : "lg:col-span-12"}>
        <PlanCard onNavigate={(p) => navigate(p)} usage={{ savedViews, dashboards }} />
      </Cell>,
    );
  }
  if (account) {
    cells.push(
      <Cell key="billing" index={index++} span="lg:col-span-5">
        <BillingCard />
      </Cell>,
      <Cell key="referral" index={index++} span="lg:col-span-12">
        <ReferralCard />
      </Cell>,
    );
  }
  return (
    <>
      {cells}
      {/* the app mounts the one ExchangeHost (sheets) – no fallback host here */}
      <ExchangeSection withHost={false} startIndex={index} />
    </>
  );
}

export function KontoPage({ className }: { className?: string }) {
  const enabled = cloudEnabled() && !hasClaudeRuntime();
  return <KontoView className={className} extraCards={enabled ? <KontoExtras /> : undefined} />;
}
