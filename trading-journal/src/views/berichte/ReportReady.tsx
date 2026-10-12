/**
 * "Bericht bereit" (P04): when a week / month / quarter / year has just ended and its report has not been opened yet
 * (`pendingReports`, seen markers in `settings.coach.reports.seen`), ONE full-screen wipe announces the most important
 * one – red curtain, black panel, the report name, its net result and three figures rising in (`FullscreenWipe` +
 * `WipeItem`). It shows once per period and device (`storageKey("report-ready")` holds the announced keys; announcing a
 * quarter also covers the month and week that ended with it); "Bericht öffnen" selects the report and hands over to
 * the page (`onOpen`), "Später" just closes – the archive keeps its "neu" marker.
 *
 * P14: mount `<ReportReadyHost onOpen={() => navigate("berichte")} />` once in App.tsx (a leaf with `data-layer`).
 */
import { useEffect, useMemo, useState } from "react";
import { useEntitlement } from "@/billing/entitlements";
import { KIND_REPORT, pendingReports, type ArchiveEntry } from "@/domain/reports";
import { cn } from "@/lib/cn";
import { pct0, signed } from "@/lib/format";
import { FullscreenWipe, WipeItem } from "@/motion/pulse/FullscreenWipe";
import { useEnriched, useJournal } from "@/store/journalStore";
import { useShareRoute } from "@/store/router";
import { readRaw, storageKey, writeRaw } from "@/store/storage";
import { useMinuteClock } from "@/views/coach/hooks";
import { openReport } from "./berichteStore";

export const READY_KEY = storageKey("report-ready");
/** Announced keys kept per device (newest first). */
const READY_MAX = 24;

/** The announced keys stored on this device (a JSON list; an older single key is read as a list of one). */
export function readAnnounced(): string[] {
  const raw = readRaw(READY_KEY);
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string") : [raw];
  } catch {
    return [raw];
  }
}

export function ReportReadyHost({ onOpen }: { onOpen?: (key: string) => void }) {
  const allowed = useEntitlement("reports");
  const loaded = useJournal((s) => s.loaded);
  const settings = useJournal((s) => s.settings);
  const enriched = useEnriched();
  const now = useMinuteClock();
  const [announced, setAnnounced] = useState<readonly string[]>(readAnnounced);
  /** the announced report (kept after closing, so the wipe can play out) */
  const [entry, setEntry] = useState<ArchiveEntry | null>(null);
  const [open, setOpen] = useState(false);
  // never over a shared link (`#share/<token>`, P14): the visitor came for the shared trade, the wipe waits for the app
  const sharing = useShareRoute((s) => s.token !== null);
  const batch = useMemo(() => (loaded && allowed && !sharing ? pendingReports(enriched, settings, now) : []), [loaded, allowed, sharing, enriched, settings, now]);
  // the most important report that was not announced yet; announcing it covers the smaller ones that ended with it
  // (a quarter that ended also ended a month and a week: ONE wipe, never three on three app starts)
  const next = batch.find((e) => !announced.includes(e.period.key)) ?? null;
  // announce it (React's "adjust state while rendering" – no effect round trip)
  if (next) {
    setAnnounced([...batch.map((e) => e.period.key), ...announced.filter((k) => !batch.some((e) => e.period.key === k))].slice(0, READY_MAX));
    setEntry(next);
    setOpen(true);
  }

  // remember the announcement at once: a reload never plays it again
  useEffect(() => {
    if (announced.length) writeRaw(READY_KEY, JSON.stringify(announced));
  }, [announced]);

  const close = () => setOpen(false);
  const view = () => {
    if (entry) {
      openReport(entry.period.key);
      onOpen?.(entry.period.key);
    }
    close();
  };
  if (!entry) return null;
  const pending = entry;
  const net = pending.net;
  return (
    <FullscreenWipe open={open} onClose={close} label="Bericht bereit">
      <div className="mx-auto grid min-h-full max-w-[880px] content-center gap-7 px-6 py-20" data-testid="report-ready" data-key={pending.period.key}>
        <WipeItem index={0}>
          <span className="label">Bericht bereit</span>
        </WipeItem>
        <WipeItem index={1}>
          <h2 className="text-[clamp(36px,7vw,76px)] font-medium leading-[0.98] tracking-[-0.035em] text-fg">
            {KIND_REPORT[pending.period.kind]}
            <span className="block text-mute">{pending.period.label}</span>
          </h2>
        </WipeItem>
        <WipeItem index={2}>
          <dl className="grid max-w-[560px] grid-cols-3 gap-3">
            {[
              ["Netto", `${signed(net, 0)} ${settings.currency}`, net > 0 ? "text-win" : net < 0 ? "text-loss" : "text-fg"],
              ["Trades", `${pending.n}`, "text-fg"],
              ["Win-Rate", pct0(pending.winRate), "text-fg"],
            ].map(([k, v, c]) => (
              <div key={k} className="grid min-w-0 gap-1 border-t border-white/15 pt-2">
                <dt className="text-[10px] font-semibold uppercase tracking-[0.14em] text-mute">{k}</dt>
                <dd className={cn("dot-num truncate text-[clamp(20px,4vw,30px)] leading-none", c)}>{v}</dd>
              </div>
            ))}
          </dl>
        </WipeItem>
        <WipeItem index={3} className="flex flex-wrap gap-3">
          <button type="button" onClick={view} className="touch-hit rounded-full bg-fg px-5 py-2.5 text-[14px] font-medium text-ink-950" data-testid="report-ready-open">
            Bericht öffnen
          </button>
          <button type="button" onClick={close} className="touch-hit rounded-full border border-white/20 px-5 py-2.5 text-[14px] text-mute hover:text-fg">
            Später
          </button>
        </WipeItem>
      </div>
    </FullscreenWipe>
  );
}
