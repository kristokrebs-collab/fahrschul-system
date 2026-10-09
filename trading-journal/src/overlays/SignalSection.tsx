/**
 * "Einstiegs-Check zum Zeitpunkt" in the trade editor (other journal `forms.tsx` SignalSection, on Binance data):
 * - a NEW trade (or a re-check) dated within 5 min of now shows the live check (`useSignalCheck`); the snapshot that
 *   is stored is taken at save time (`resolveTradeSignal`);
 * - a back-dated trade is recomputed from exchange history ending at its time (`retroCheck`, debounced 300 ms, one
 *   memoised fetch per minute) with a loading state; too little history → "Zu wenig Kursdaten …" – never a fake
 *   strength 0;
 * - an existing trade shows its stored snapshot (either app's format) and is only re-checked on "Neu prüfen" /
 *   "Prüfen", or automatically when its date / side changed (the stored check no longer describes it).
 * The section reports the `s_mtf` auto-ticks of the snapshot it shows (`onAuto`); only this component subscribes to
 * the live check, so the form never re-renders with it.
 */
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { LIVE_WINDOW_MS, LOADING_TEXT, mtfAutoChecks, OFFLINE_TEXT, RETRO_LOADING, STALE_TEXT, toSignalSnapshot, type MtfItem, type Side, type SignalSnapshot } from "@/domain/signals";
import { checkTradeAt, getSignalConfig, retroCheck, toTradeSnapshot, useSignalCheck, type LiveSignals, type RetroResult } from "@/market/signals";
import { TextShimmer } from "@/motion/TextShimmer";
import { tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives";
import { AutoHeight } from "@/views/trades/AutoHeight";
import { SignalSummary } from "./SignalSummary";

export const SIGNAL_SECTION_TITLE = "Einstiegs-Check zum Zeitpunkt";
/** Debounce of the retro check while the date is being edited. */
export const RETRO_DEBOUNCE_MS = 300;
/** Longest a save waits for a check that is still loading (then the trade is saved without a new snapshot). */
export const SAVE_CHECK_TIMEOUT_MS = 3000;

export const SIGNAL_SECTION_COPY = {
  subAuto: "automatisch aus Binance-Kerzen",
  subStored: "gespeichert beim Eintragen",
  live: "Live-Check · wird beim Speichern mitgespeichert",
  changed: "Datum oder Richtung geändert · der Check wird für den neuen Zeitpunkt gerechnet",
  tooFew: "Zu wenig Kursdaten für diesen Zeitpunkt.",
  noDate: "Mit Datum und Uhrzeit wird der Check für diesen Zeitpunkt gerechnet.",
  none: "Für diesen Trade ist kein Einstiegs-Check gespeichert.",
  check: "Prüfen",
  recheck: "Neu prüfen",
  retry: "Erneut versuchen",
} as const;

export type MtfAuto = Record<MtfItem, boolean>;

/** ms of a `datetime-local` value (local time), NaN when empty / invalid. */
export function localMs(date: string): number {
  return date ? new Date(date).getTime() : NaN;
}

/**
 * The snapshot to store when a trade is saved with a check running: live within 5 min of now (the freshest
 * evaluation at this moment), otherwise the (memoised) retro check of that minute. `undefined` = keep whatever the
 * trade had (no data, too little history, failed or still loading after `SAVE_CHECK_TIMEOUT_MS`). Never rejects.
 */
export async function resolveTradeSignal(date: string, side: Side, timeoutMs = SAVE_CHECK_TIMEOUT_MS): Promise<SignalSnapshot | undefined> {
  const t = localMs(date);
  if (!Number.isFinite(t)) return undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<null>((res) => {
    timer = setTimeout(() => res(null), timeoutMs);
  });
  try {
    const snap = await Promise.race([checkTradeAt(t, side), timeout]);
    return snap ?? undefined;
  } catch {
    return undefined;
  } finally {
    clearTimeout(timer);
  }
}

export interface SignalSectionProps {
  /** `datetime-local` value of the form. */
  date: string;
  side: Side;
  /** A check runs (new trade, explicit re-check, or date / side changed on a trade with a stored check). */
  checking: boolean;
  /** Parsed `trade.signal` of the trade being edited. */
  stored: SignalSnapshot | null;
  /** The check runs because date / side changed (sub line says so). */
  changed?: boolean;
  /** `Prüfen` / `Neu prüfen`. */
  onCheck: () => void;
  /** Auto-ticks of the `s_mtf` checklist for the snapshot on screen (`null` = none); called when they change. */
  onAuto: (auto: MtfAuto | null) => void;
}

const autoKey = (s: SignalSnapshot | null) => (s ? `${s.tiers}|${s.rsiOk}|${s.zoneOk}` : "");

/** Reports `mtfAutoChecks(snap)` upwards whenever the ticks it implies change (not on every score change). */
function useReportAuto(snap: SignalSnapshot | null, onAuto: (auto: MtfAuto | null) => void): void {
  const key = autoKey(snap);
  const [last, setLast] = useState<{ key: string; snap: SignalSnapshot | null }>({ key: "", snap: null });
  if (last.key !== key) setLast({ key, snap });
  useEffect(() => {
    onAuto(last.snap ? mtfAutoChecks(last.snap) : null);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- report on a change of the ticks only
  }, [last.key]);
}

/** The section body. Wrapped by the editor's `Section` (title + sub come from `signalSectionSub`). */
export function SignalSection({ date, side, checking, stored, changed, onCheck, onAuto }: SignalSectionProps) {
  const t = localMs(date);
  const minute = Number.isFinite(t) ? Math.floor(t / 60_000) : null;
  const [now, setNow] = useState(() => Date.now());
  // the live window moves with the clock while the form is open (a form left open for minutes turns "retro")
  useEffect(() => {
    if (!checking) return;
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, [checking]);
  const live = checking && minute != null && t >= now - LIVE_WINDOW_MS;

  let body: ReactNode;
  let key: string;
  if (!checking) {
    key = stored ? "stored" : "none";
    body = <StoredView stored={stored} side={side} onCheck={onCheck} onAuto={onAuto} />;
  } else if (minute == null) {
    key = "nodate";
    body = <EmptyLine text={SIGNAL_SECTION_COPY.noDate} onAuto={onAuto} />;
  } else if (live) {
    key = "live";
    body = <LiveView side={side} onAuto={onAuto} />;
  } else {
    key = "retro";
    body = <RetroView minute={minute} side={side} onAuto={onAuto} />;
  }
  const note = checking ? (changed ? SIGNAL_SECTION_COPY.changed : live ? SIGNAL_SECTION_COPY.live : null) : null;
  return (
    <AutoHeight>
      <AnimatePresence mode="wait" initial={false}>
        <motion.div key={key} className="grid gap-2" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: tween.exit }} transition={tween.fade} data-signal-view={key} data-changed={changed || undefined}>
          {body}
          {note && <p className="text-[11.5px] text-faint">{note}</p>}
        </motion.div>
      </AnimatePresence>
    </AutoHeight>
  );
}

/** Sub line of the section heading: a stored check that is shown as is, otherwise the data source. */
export function signalSectionSub(p: { checking: boolean; stored: SignalSnapshot | null }): string {
  return !p.checking && p.stored ? SIGNAL_SECTION_COPY.subStored : SIGNAL_SECTION_COPY.subAuto;
}

function StoredView({ stored, side, onCheck, onAuto }: { stored: SignalSnapshot | null; side: Side; onCheck: () => void; onAuto: (a: MtfAuto | null) => void }) {
  useReportAuto(stored, onAuto);
  if (!stored) {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line-2 px-3.5 py-3">
        <span className="text-[12.5px] text-mute">{SIGNAL_SECTION_COPY.none}</span>
        <Button size="sm" onClick={onCheck}>
          {SIGNAL_SECTION_COPY.check}
        </Button>
      </div>
    );
  }
  return (
    <div className="grid gap-2">
      <SignalSummary snap={stored} side={side} />
      <div className="flex justify-end">
        <Button size="sm" onClick={onCheck}>
          {SIGNAL_SECTION_COPY.recheck}
        </Button>
      </div>
    </div>
  );
}

function LiveView({ side, onAuto }: { side: Side; onAuto: (a: MtfAuto | null) => void }) {
  const check = useSignalCheck();
  const live = check.snapshot;
  const snap = useMemo(() => (live ? toTradeSnapshot(live, side) : null), [live, side]);
  useReportAuto(snap, onAuto);
  if (!snap) return <LoadingLine text={check.state === "offline" ? (check.message ?? OFFLINE_TEXT) : (check.message ?? LOADING_TEXT)} busy={check.state === "loading"} />;
  // a provisional live entry counts down to its base candle's close (stored snapshots record only the state)
  const v = live ? (side === "long" ? live.long : live.short) : null;
  const closesAt = v?.state === "provisional" ? (v.closesAt ?? null) : null;
  return (
    <div className="grid gap-2">
      <SignalSummary snap={snap} side={side} closesAt={closesAt} />
      {check.state === "stale" && <p className="text-[11.5px] text-warn">{check.message ?? STALE_TEXT}</p>}
    </div>
  );
}

function RetroView({ minute, side, onAuto }: { minute: number; side: Side; onAuto: (a: MtfAuto | null) => void }) {
  const [attempt, setAttempt] = useState(0);
  const [got, setGot] = useState<{ minute: number; attempt: number; result: RetroResult } | null>(null);
  useEffect(() => {
    let alive = true;
    const id = setTimeout(() => {
      void retroCheck(minute * 60_000).then((result) => {
        if (alive) setGot({ minute, attempt, result });
      });
    }, RETRO_DEBOUNCE_MS);
    return () => {
      alive = false;
      clearTimeout(id);
    };
  }, [minute, attempt]);
  const result = got && got.minute === minute && got.attempt === attempt ? got.result : null;
  const snap = useMemo(() => {
    if (!result?.signals) return null;
    if (result.status === "live") return toTradeSnapshot(result.signals as LiveSignals, side);
    return toSignalSnapshot(result.signals, side, getSignalConfig(), { mode: "retro", symbol: result.symbol ?? undefined, source: result.source ?? undefined });
  }, [result, side]);
  useReportAuto(snap, onAuto);
  if (!result) return <LoadingLine text={RETRO_LOADING} busy />;
  if (snap) return <SignalSummary snap={snap} side={side} />;
  if (result.status === "error") {
    return (
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-dashed border-line-2 px-3.5 py-3">
        <span className="text-[12.5px] text-mute">{result.message}</span>
        <Button size="sm" onClick={() => setAttempt((a) => a + 1)}>
          {SIGNAL_SECTION_COPY.retry}
        </Button>
      </div>
    );
  }
  return <EmptyLine text={result.status === "no-history" ? SIGNAL_SECTION_COPY.tooFew : (result.message ?? SIGNAL_SECTION_COPY.tooFew)} />;
}

function LoadingLine({ text, busy }: { text: string; busy?: boolean }) {
  const reduced = useReducedFx();
  return (
    <div className="rounded-2xl border border-dashed border-line-2 px-3.5 py-3 text-[12.5px]" aria-busy={busy || undefined} data-testid="signal-loading">
      <TextShimmer active={busy && !reduced} className="text-[12.5px]">
        {text}
      </TextShimmer>
    </div>
  );
}

function EmptyLine({ text, onAuto }: { text: string; onAuto?: (a: MtfAuto | null) => void }) {
  useReportAuto(null, onAuto ?? noop);
  return (
    <div className="rounded-2xl border border-dashed border-line-2 px-3.5 py-3 text-[12.5px] text-mute" data-testid="signal-empty">
      {text}
    </div>
  );
}

const noop = () => {};
