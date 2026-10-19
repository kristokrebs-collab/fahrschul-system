import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import { LocalModeBanner } from "@/app/LocalModeBanner";
import { toIslandToast } from "@/app/toasts";
import { BillingHost } from "@/billing/ui";
import { CloudSyncHost } from "@/cloud/CloudSyncHost";
import { setCloudEnabledForTests } from "@/cloud/env";
import { AccountPill } from "@/cloud/ui/AccountPill";
import { ExchangeHost, ExchangeSection, openCsvImport, useExchangePositions } from "@/exchanges";
import { Celebrate } from "@/motion/Celebrate";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { Reveal } from "@/motion/Reveal";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { ToastIsland } from "@/primitives/Toast";
import { bootJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { KontoView } from "@/views/konto";

/*
 * Dev harness of P11 until the integrator mounts the exchange cards in Konto (P14): `/dev/boerse.html` under `npm run dev`.
 * - The Konto page with `extraCards={<ExchangeSection />}` – exactly the planned integration – and the app-level
 *   `ExchangeHost` (the section's own host stays inactive: one host at a time) next to P10's `BillingHost` (plan gates).
 * - "Live-Positionen" consumes `useExchangePositions()` the way P05 will (proves the polling contract).
 * - `?cloud=off` – the build without cloud: no exchange cards, the CSV import still works (button in the header).
 * - With `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (e2e: the Supabase mock) the real login runs;
 *   tests/e2e/mocks/exchange.ts fakes the exchange functions with the real Bitunix mapping.
 */
const params = new URLSearchParams(location.search);
if (params.get("cloud") === "off") setCloudEnabledForTests(false);
void bootJournal({ autoBackup: false });
(window as unknown as { __tjJournal?: typeof useJournal }).__tjJournal = useJournal;

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const island = useMemo(() => toasts.map(toIslandToast), [toasts]);
  return <ToastIsland toasts={island} onDismiss={dismiss} />;
}

/** What P05 sees: the open positions of the connected venue (polled while mounted). */
function PositionsProbe() {
  const positions = useExchangePositions();
  if (!positions.length) return null;
  return (
    <Reveal index={9} className="min-w-0 lg:col-span-12">
      <Card title="Live-Positionen (P05-Vertrag)">
        <ul className="grid gap-1.5 text-[12.5px]" data-testid="positions-probe">
          {positions.map((p) => (
            <li key={p.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-line bg-ink-950/40 px-3 py-2">
              <span className="font-medium">
                {p.symbol} <span className={p.side === "long" ? "text-win" : "text-loss"}>{p.side}</span>
              </span>
              <span className="num font-mono text-mute">
                {p.qty} @ {p.entry} · Mark {p.mark ?? "–"} · uPnL {p.unrealizedPnl ?? "–"}
              </span>
            </li>
          ))}
        </ul>
      </Card>
    </Reveal>
  );
}

function Harness() {
  return (
    <MorphDialogProvider>
      <header className="sticky top-0 z-40 border-b border-line bg-ink-900">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6">
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900 font-mono text-[15px] font-semibold">
              ₿
            </span>
            <span className="truncate text-[15px] font-semibold tracking-tight">Trade Journal</span>
          </span>
          <span className="flex items-center gap-2">
            <Button size="sm" onClick={openCsvImport} data-testid="harness-csv">
              CSV
            </Button>
            <AccountPill />
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-6 sm:px-6">
        <LocalModeBanner />
        <KontoView
          extraCards={
            <>
              <ExchangeSection withHost={false} />
              <PositionsProbe />
            </>
          }
        />
      </main>
      <CloudSyncHost onOpenAccount={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
      <ExchangeHost />
      <BillingHost onNavigate={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
      <Toasts />
      <Celebrate />
    </MorphDialogProvider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionRoot>
      <Harness />
    </MotionRoot>
  </StrictMode>,
);
