import { StrictMode, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import { LocalModeBanner } from "@/app/LocalModeBanner";
import { toIslandToast } from "@/app/toasts";
import { BillingHost } from "@/billing/ui";
import { CloudSyncHost } from "@/cloud/CloudSyncHost";
import { setCloudEnabledForTests } from "@/cloud/env";
import { AccountPill } from "@/cloud/ui/AccountPill";
import { Celebrate } from "@/motion/Celebrate";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { ToastIsland } from "@/primitives/Toast";
import { parseShareHash } from "@/social/links";
import { fmtR } from "@/social/format";
import { ShareButton, SocialHost } from "@/social/ui";
import { bootJournal, useEnriched, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { CommunityView, SharedView } from "@/views/community";

/*
 * Dev harness of the P12 pages until the integrator registers `community` and the `share/<token>` route (P14):
 * `/dev/community.html` under `npm run dev` (Vite dev server).
 * - `#community` (default, also `#community?invite=CODE`) – the Community page;
 * - `#share/<token>` – the public SharedView;
 * - `#trades` – a stand-in for the trade detail: the newest trades with the real ShareButton (→ SocialHost's sheet);
 * - `?cloud=off` – the build without cloud ("Community braucht die Cloud").
 * With `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` (e2e: the Supabase mock) the real login, the real hosts and
 * the real journal store run; tests/e2e/mocks/social.ts fakes the community functions.
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

type Route = { page: "community" } | { page: "trades" } | { page: "share"; token: string };
const routeOf = (): Route => {
  const token = parseShareHash(location.hash);
  if (token) return { page: "share", token };
  if (location.hash.startsWith("#trades")) return { page: "trades" };
  return { page: "community" };
};

function useRoute(): Route {
  const [r, setR] = useState<Route>(routeOf);
  useEffect(() => {
    const on = () => setR(routeOf());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

/** Stand-in for the trade detail (P14 puts `<ShareButton tradeId>` into TradeDetail). */
function TradesDemo() {
  const trades = useEnriched();
  const recent = useMemo(() => [...trades].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 8), [trades]);
  return (
    <div className="grid gap-3" data-testid="trades-demo">
      <h1 className="text-[24px] font-semibold tracking-tight">Trades (Harness)</h1>
      <ul className="grid gap-2">
        {recent.map((t) => (
          <li key={t.id} className="flex items-center justify-between gap-3 rounded-2xl border border-line bg-ink-900 px-4 py-3" data-testid="demo-trade">
            <span className="grid">
              <span className="text-[13.5px] font-medium">
                {t.pair} · {t.side === "short" ? "Short" : "Long"}
              </span>
              <span className="font-mono text-[11px] text-faint">{t.date.replace("T", " · ")}</span>
            </span>
            <span className="flex items-center gap-3">
              <span className="num font-mono text-[13px]">{fmtR(t.r)}</span>
              <ShareButton tradeId={t.id} />
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function Harness() {
  const route = useRoute();
  return (
    <MorphDialogProvider>
      <header className="sticky top-0 z-40 border-b border-line bg-ink-900">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6">
          <span className="flex min-w-0 items-center gap-3">
            <span className="grid size-9 shrink-0 place-items-center rounded-xl border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900 font-mono text-[15px] font-semibold">₿</span>
            <nav className="flex gap-1 text-[13px]">
              {(["community", "trades"] as const).map((p) => (
                <a key={p} href={`#${p}`} aria-current={route.page === p ? "page" : undefined} className="rounded-full px-3 py-1.5 text-mute aria-[current=page]:bg-white/[0.06] aria-[current=page]:text-fg">
                  {p === "community" ? "Community" : "Trades"}
                </a>
              ))}
            </nav>
          </span>
          <AccountPill />
        </div>
      </header>
      <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-6 sm:px-6">
        <LocalModeBanner />
        {route.page === "share" ? <SharedView token={route.token} onOpenApp={() => (location.hash = "community")} /> : route.page === "trades" ? <TradesDemo /> : <CommunityView />}
      </main>
      <CloudSyncHost onOpenAccount={() => (location.hash = "community")} />
      <BillingHost onNavigate={() => (location.hash = "community")} />
      <SocialHost />
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
