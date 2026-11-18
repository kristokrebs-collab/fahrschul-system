import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import { LocalModeBanner } from "@/app/LocalModeBanner";
import { toIslandToast } from "@/app/toasts";
import { Gate } from "@/billing/entitlements";
import { BillingBanner, BillingCard, BillingHost, PlanCard, ReferralCard, UpgradeTeaser } from "@/billing/ui";
import { CloudSyncHost } from "@/cloud/CloudSyncHost";
import { setCloudEnabledForTests } from "@/cloud/env";
import { AccountPill } from "@/cloud/ui/AccountPill";
import { Celebrate } from "@/motion/Celebrate";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { Reveal } from "@/motion/Reveal";
import { ToastIsland } from "@/primitives/Toast";
import { bootJournal, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { useViews } from "@/store/viewsStore";
import { KontoView } from "@/views/konto";
import { PreiseView } from "@/views/preise";

/*
 * Dev harness of the P10 pages until the integrator registers `preise` (and adds the billing cards to Konto, P14):
 * `/dev/preise.html` under `npm run dev` (Vite dev server).
 * - `#preise` (default) – the pricing page; `#konto` – the Konto page with PlanCard / BillingCard / ReferralCard as
 *   `extraCards` plus an example `<Gate feature="monteCarlo">` with its UpgradeTeaser and the BillingBanner.
 * - `?cloud=off` – the build without cloud ("keine Abos in dieser Version").
 * - With `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (e2e: the Supabase mock) the real login, the real
 *   BillingHost (status, checkout redirects, return wipe) and the real journal store run; tests/e2e/mocks/billing.ts
 *   fakes the billing functions and the Stripe pages.
 */
const params = new URLSearchParams(location.search);
if (params.get("cloud") === "off") setCloudEnabledForTests(false);
void bootJournal({ autoBackup: false });

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const island = useMemo(() => toasts.map(toIslandToast), [toasts]);
  return <ToastIsland toasts={island} onDismiss={dismiss} />;
}

type Page = "preise" | "konto";
const pageOf = (): Page => (location.hash === "#konto" ? "konto" : "preise");

function usePage(): [Page, (p: Page) => void] {
  const [page, setPage] = useState<Page>(pageOf);
  useEffect(() => {
    const on = () => setPage(pageOf());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  const go = (p: Page) => {
    location.hash = p;
    window.scrollTo({ top: 0 });
  };
  return [page, go];
}

function MonteCarloDemo() {
  return (
    <div className="grid gap-2 rounded-2xl border border-line bg-ink-900 p-5" data-testid="montecarlo-demo">
      <span className="label">Monte Carlo</span>
      <p className="text-[13px] text-mute">Inhalt des Pro-Features (Beispiel im Harness).</p>
    </div>
  );
}

function KontoExtras({ go }: { go: (p: Page) => void }) {
  const views = useViews((s) => s.views.length);
  return (
    <>
      <Reveal index={5} className="min-w-0 lg:col-span-7">
        <PlanCard onNavigate={go} usage={{ savedViews: views }} />
      </Reveal>
      <Reveal index={6} className="min-w-0 lg:col-span-5">
        <BillingCard />
      </Reveal>
      <Reveal index={7} className="min-w-0 lg:col-span-7">
        <ReferralCard />
      </Reveal>
      <Reveal index={8} className="min-w-0 lg:col-span-5">
        <Gate feature="monteCarlo" fallback={<UpgradeTeaser feature="monteCarlo" />}>
          <MonteCarloDemo />
        </Gate>
      </Reveal>
    </>
  );
}

function Harness() {
  const [page, go] = usePage();
  return (
    <MorphDialogProvider>
      <header className="sticky top-0 z-40 border-b border-line bg-ink-900">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6">
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900 font-mono text-[15px] font-semibold">
              ₿
            </span>
            <nav className="flex gap-1 text-[13px]">
              {(["preise", "konto"] as const).map((p) => (
                <a
                  key={p}
                  href={`#${p}`}
                  aria-current={page === p ? "page" : undefined}
                  className="rounded-full px-3 py-1.5 text-mute aria-[current=page]:bg-white/[0.06] aria-[current=page]:text-fg"
                >
                  {p === "preise" ? "Preise" : "Konto"}
                </a>
              ))}
            </nav>
          </span>
          <AccountPill />
        </div>
      </header>
      <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-6 sm:px-6">
        <LocalModeBanner />
        <BillingBanner className="mb-5" />
        {page === "preise" ? <PreiseView /> : <KontoView extraCards={<KontoExtras go={go} />} />}
      </main>
      <CloudSyncHost onOpenAccount={() => go("konto")} />
      <BillingHost onNavigate={go} />
      <Toasts />
      <Celebrate />
    </MorphDialogProvider>
  );
}

// e2e hook (dev harness only)
(window as unknown as { __tjJournal?: typeof useJournal }).__tjJournal = useJournal;

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <MotionRoot>
      <Harness />
    </MotionRoot>
  </StrictMode>,
);
