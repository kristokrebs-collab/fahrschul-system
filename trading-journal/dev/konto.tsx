import { StrictMode, useMemo } from "react";
import { createRoot } from "react-dom/client";
import "../src/styles/base.css";
import { LocalModeBanner } from "@/app/LocalModeBanner";
import { toIslandToast } from "@/app/toasts";
import { CloudSyncHost } from "@/cloud/CloudSyncHost";
import { setCloudEnabledForTests } from "@/cloud/env";
import { AccountPill } from "@/cloud/ui/AccountPill";
import { Celebrate } from "@/motion/Celebrate";
import { MorphDialogProvider } from "@/motion/MorphDialog";
import { MotionRoot } from "@/motion/MotionRoot";
import { StatusPill } from "@/motion/StatusPill";
import { ToastIsland } from "@/primitives/Toast";
import { bootJournal, modeLabelFor, useJournal } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { KontoView } from "@/views/konto";

/*
 * Dev harness of the P09 Konto page until the integrator registers `konto` (P14): `/dev/konto.html` under `npm run dev`.
 * `?cloud=off` shows the "Cloud nicht eingerichtet" state; otherwise the build env decides (`VITE_SUPABASE_URL` +
 * `VITE_SUPABASE_PUBLISHABLE_KEY`; the e2e spec points them at the Supabase mock of tests/e2e/mocks/supabase.ts).
 * The strip at the top stands in for the app header (mode pill + the new account pill), the rest is the real page,
 * the real hosts (CloudSyncHost with the login sheet, toasts, confetti) and the real journal store.
 */
const params = new URLSearchParams(location.search);
if (params.get("cloud") === "off") setCloudEnabledForTests(false);
void bootJournal({ autoBackup: false });
// e2e hook (dev harness only): write through the store API like the trade editor does
(window as unknown as { __tjJournal?: typeof useJournal }).__tjJournal = useJournal;

function Toasts() {
  const toasts = useUi((s) => s.toasts);
  const dismiss = useUi((s) => s.dismissToast);
  const island = useMemo(() => toasts.map(toIslandToast), [toasts]);
  return <ToastIsland toasts={island} onDismiss={dismiss} />;
}

function ModePill() {
  const mode = useJournal((s) => s.mode);
  const storage = useJournal((s) => s.storage);
  const label = modeLabelFor(mode, storage);
  const tone = mode === "cloud" ? "live" : mode === "local" ? "warn" : mode === "error" ? "error" : "muted";
  return (
    <span className="max-md:hidden" data-testid="mode-pill" title={label.text}>
      <StatusPill tone={tone} expanded label={label.text} />
    </span>
  );
}

function Harness() {
  return (
    <MorphDialogProvider>
      <header className="sticky top-0 z-40 border-b border-line bg-ink-900">
        <div className="mx-auto flex h-16 max-w-[1320px] items-center justify-between gap-3 px-4 sm:px-6">
          <span className="flex items-center gap-3">
            <span className="grid size-9 place-items-center rounded-xl border border-line-2 bg-gradient-to-br from-ink-700 to-ink-900 font-mono text-[15px] font-semibold">₿</span>
            <span className="text-[15px] font-semibold tracking-tight">Trade Journal</span>
          </span>
          <span className="flex items-center gap-3">
            <ModePill />
            <AccountPill />
          </span>
        </div>
      </header>
      <main className="mx-auto max-w-[1320px] px-4 pb-16 pt-6 sm:px-6">
        <LocalModeBanner />
        <KontoView />
      </main>
      <CloudSyncHost onOpenAccount={() => window.scrollTo({ top: 0, behavior: "smooth" })} />
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
