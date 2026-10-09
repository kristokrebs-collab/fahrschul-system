import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState, type CSSProperties, type RefObject } from "react";
import { DATA_SOURCE_NOTE, DEFAULT_SIGNAL_CFG, LOADING_TEXT, OFFLINE_TEXT, SIGNAL_TITLE, signalInfo, type Side } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { SIGNAL_HOLD_MS, useSignalCheck, type LiveSignals } from "@/market";
import { NoLayoutCascade } from "@/motion/NoLayoutCascade";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { StatusPill } from "@/motion/StatusPill";
import { TextShimmer } from "@/motion/TextShimmer";
import { tween } from "@/motion/tokens";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Card } from "@/primitives/Card";
import { Collapse, Expander } from "@/primitives/Expander";
import { Segmented } from "@/primitives/Segmented";
import { Skeleton } from "@/primitives/Skeleton";
import { Explainer, type ExplainerData } from "@/primitives/VerdictPanel";
import { storageKey } from "@/store/storage";
import { BiasBar } from "./BiasBar";
import { PartsSection, Reasons, RungTile, VerdictRow, ZoneGauge } from "./signalParts";
import { entryLevels, freshEntry, ladderText, partViews, rungViews, statusPill, verdictStateLine, type EntryLevels, type RungView } from "./signalView";
import { useForceRefresh } from "./useMarket";

export const SIGNAL_CARD_ID = "signal-card";
export const SIGNAL_INFO_ID = `${SIGNAL_CARD_ID}-info`;
export const FRESH_ENTRY_TEXT: Record<Side, string> = { long: "Neuer Long-Einstieg", short: "Neuer Short-Einstieg" };
const SIDE_OPTIONS = [
  { v: "long", label: "Long" },
  { v: "short", label: "Short" },
] as const;
const SIDE_TONES = { long: "!border-win/30", short: "!border-loss/30" } as const;

interface FreshState {
  /** `long|short` entry levels of the last evaluation (`""` = none yet) */
  key: string;
  prev: EntryLevels | null;
  /** fresh entries per side since mount (drives the one-shot ring halo) */
  n: Record<Side, number>;
  /** the latest fresh entry, while its badge shows */
  last: { side: Side; seq: number } | null;
  seq: number;
}

/**
 * Detects a NEW valid entry (or a stronger one) between two published evaluations – state-from-props, no effect.
 * Never on the first evaluation, so opening the page or a reconnect announces nothing. The badge clears after
 * `SIGNAL_HOLD_MS` or as soon as that side is no longer valid.
 */
function useFreshEntry(snap: LiveSignals | null): { n: Record<Side, number>; last: FreshState["last"] } {
  const levels = snap ? entryLevels(snap) : null;
  const key = levels ? `${levels.long}|${levels.short}` : "";
  const [st, setSt] = useState<FreshState>(() => ({ key, prev: levels, n: { long: 0, short: 0 }, last: null, seq: 0 }));
  let cur = st;
  if (st.key !== key) {
    const side = levels ? freshEntry(st.prev, levels) : null;
    const seq = side ? st.seq + 1 : st.seq;
    const last = side ? { side, seq } : st.last && levels && levels[st.last.side] > 0 ? st.last : null;
    cur = { key, prev: levels, n: side ? { ...st.n, [side]: st.n[side] + 1 } : st.n, last, seq };
    setSt(cur);
  }
  const lastSeq = cur.last?.seq ?? 0;
  useEffect(() => {
    if (!lastSeq) return;
    const t = setTimeout(() => setSt((s) => (s.last?.seq === lastSeq ? { ...s, last: null } : s)), SIGNAL_HOLD_MS);
    return () => clearTimeout(t);
  }, [lastSeq]);
  return { n: cur.n, last: cur.last };
}

const matchKeys = (rungs: readonly RungView[]): Set<string> => new Set(rungs.filter((r) => r.match && r.event).map((r) => rungKey(r)));
const rungKey = (r: RungView): string => `${r.tf}:${r.event?.kind ?? "-"}`;

/**
 * Rung keys (`tf:kind`) whose direction-matching event appeared since the last evaluation – they "light up" once.
 * The first evaluation and a side switch only seed (nothing flashes on load or on a toggle).
 */
function useFreshRungs(rungs: readonly RungView[], side: Side): ReadonlySet<string> {
  const sig = rungs.map((r) => (r.match && r.event ? `${rungKey(r)}:${r.check?.closeAt ?? 0}` : `${r.tf}:-`)).join("|") + `|${side}`;
  const [st, setSt] = useState(() => ({ sig, side, prev: rungs.length ? matchKeys(rungs) : null, fresh: new Set<string>() as ReadonlySet<string> }));
  if (st.sig === sig) return st.fresh;
  const now = rungs.length ? matchKeys(rungs) : null;
  const prev = st.prev;
  const fresh: ReadonlySet<string> = new Set(prev && now && st.side === side ? [...now].filter((k) => !prev.has(k)) : []);
  setSt({ sig, side, prev: now, fresh });
  return fresh;
}

function infoData(snap: LiveSignals | null): ExplainerData {
  const cfgSymbol = snap?.symbol ?? "BTCUSDT";
  const d = signalInfo(snap?.cfg ?? DEFAULT_SIGNAL_CFG, cfgSymbol);
  return {
    title: d.title,
    what: d.what,
    formula: (
      <>
        {d.formula[0]}
        <br />
        {d.formula[1]}
      </>
    ),
    rows: d.rows.map((r) => [r.k, r.v] as const),
    verdict: { tone: "mute", text: d.verdict },
  };
}

/** Height-reserving placeholder while the first evaluation loads (the card sits above the chart: no jump later). */
/** Per-browser UI cache (not journal data): the evaluated card body's height per window width, `tj2-ui-signal-h`. */
export const SIGNAL_HEIGHT_KEY = storageKey("ui-signal-h");
/** Widths remembered (rotation, split screen, a desktop window): the most recent ones win. */
const HEIGHT_WIDTHS = 6;

const widthKey = (): string => (typeof window === "undefined" ? "0" : String(Math.round(window.innerWidth)));

function readHeights(): Record<string, number> {
  try {
    const raw = JSON.parse(localStorage.getItem(SIGNAL_HEIGHT_KEY) ?? "{}") as unknown;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    return Object.fromEntries(Object.entries(raw as Record<string, unknown>).filter((e): e is [string, number] => typeof e[1] === "number" && e[1] > 80 && e[1] < 8000));
  } catch {
    return {};
  }
}

/** The body height the evaluated card had at this window width last time (`null`: never seen at this width). */
export function reservedSignalHeight(): number | null {
  return readHeights()[widthKey()] ?? null;
}

/** Remembers the evaluated body height for this window width (storage failures are ignored). */
export function rememberSignalHeight(h: number): void {
  const key = widthKey();
  const all = readHeights();
  if (all[key] === h) return;
  delete all[key];
  const next = Object.fromEntries([...Object.entries(all).slice(-(HEIGHT_WIDTHS - 1)), [key, h]]);
  try {
    localStorage.setItem(SIGNAL_HEIGHT_KEY, JSON.stringify(next));
  } catch {
    /* private mode / quota: the skeleton's own height stands in */
  }
}

/** Reports the evaluated body's height (ResizeObserver, never a layout read) for the next load's skeleton. */
function useRememberHeight(ref: RefObject<HTMLElement | null>, on: boolean) {
  useEffect(() => {
    const el = ref.current;
    if (!on || !el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver((entries) => {
      const h = entries[entries.length - 1]?.borderBoxSize?.[0]?.blockSize;
      if (h && h > 80) rememberSignalHeight(Math.round(h));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, on]);
}

const SK = "rounded-xl";

/**
 * Loading state with the evaluated card's structure and heights (design pass v3, coordinator A): bias bar, verdict +
 * timeframe ladder, the three parts, zone + reasons, the source note — the same grids as the evaluated body, with the
 * section heights measured per breakpoint (390 / 430 / 640 / 768 / 1024 / 1280 / 1692). The card no longer grows by
 * ≈ 1,500 px (390) / 600 px (1692) when the first evaluation arrives, which pushed the chart below off the screen of
 * anyone already scrolled past it. When this browser has seen the evaluated card at the same window width, its exact
 * height is reserved (`reservedSignalHeight`). The loading text sits inside the bias block (no extra line).
 */
function SignalSkeleton({ rungs, message }: { rungs: number; message: string }) {
  const [reserved] = useState(reservedSignalHeight);
  return (
    <div className="grid content-start gap-5 overflow-hidden" style={reserved ? { height: reserved } : undefined} data-testid="signal-skeleton" data-reserved={reserved ?? undefined}>
      <div className="relative">
        <Skeleton className={cn(SK, "h-[157px] xl:h-[110px]")} />
        <TextShimmer as="p" className="absolute inset-x-4 top-4 text-[13px] leading-relaxed">
          {message}
        </TextShimmer>
      </div>
      <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.8fr)_2fr] xl:items-center" aria-hidden="true">
        <div className="flex h-[110px] items-center gap-4 min-[420px]:h-[86px]">
          <Skeleton className="size-[86px] shrink-0 rounded-full" />
          <div className="grid flex-1 gap-2">
            <Skeleton className="h-5 w-48 max-w-full rounded-md" />
            <Skeleton className="h-3 w-40 max-w-full rounded-md" />
          </div>
        </div>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(var(--rungs),minmax(0,1fr))]" style={{ "--rungs": Math.max(1, rungs) } as CSSProperties}>
          {Array.from({ length: rungs }, (_, i) => (
            <Skeleton key={i} className={cn(SK, "h-[183px]")} />
          ))}
        </div>
      </div>
      <div className="grid gap-2.5" aria-hidden="true">
        <Skeleton className="h-[17px] w-40 rounded-md" />
        <div className="grid gap-2 md:grid-cols-2 xl:grid-cols-[1.25fr_1fr_1fr]">
          <Skeleton className={cn(SK, "h-[319px] min-[420px]:h-[285px] sm:h-[256px] md:col-span-2 md:h-[208px] lg:h-[179px] xl:col-span-1 xl:h-[256px]")} />
          <Skeleton className={cn(SK, "h-[197px] sm:h-[182px] md:h-[202px] lg:h-[185px] xl:h-[256px]")} />
          <Skeleton className={cn(SK, "h-[202px] min-[420px]:h-[185px] md:h-[202px] lg:h-[185px] xl:h-[256px]")} />
        </div>
      </div>
      <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]" aria-hidden="true">
        <Skeleton className={cn(SK, "h-[161px] sm:h-[146px] md:h-[203px]")} />
        <Skeleton className={cn(SK, "h-[203px]")} />
      </div>
      <Skeleton className="h-[30px] w-3/4 rounded-md sm:h-[15px]" aria-hidden="true" />
    </div>
  );
}

/**
 * `Einstiegs-Check` (other journal's `signalpanel.tsx`, on Binance data): verdict ring + label + strength + the
 * candle-close state line (vorläufig · schließt in mm:ss / bestätigt / stark bestätigt), the timeframe ladder (MCB
 * event with its state, MCB and RSI meters per rung), the graded parts (ours: Top-Trader-Kombi scorecard, divergences,
 * support / resistance), the Premium/Discount zone with the live price, and the reasons. Reads `useSignalCheck()` – the engine evaluates ≤ 1/s off the render path and publishes only real changes,
 * so this card re-renders at most once per second; the zone marker follows the price as a MotionValue.
 * A NEW valid entry (never on load): one BorderBeam lap, a halo on the score ring, the rung dots that lit up pop, and a
 * `Neuer … Einstieg` marker (pulse `tactile-highlight`) that holds `SIGNAL_HOLD_MS`.
 */
export function SignalCard() {
  const check = useSignalCheck();
  const snap = check.snapshot;
  const [side, setSide] = useState<Side | null>(null);
  const [info, setInfo] = useState(false);
  const { refresh, refreshing, disabled } = useForceRefresh();
  const cur: Side = side ?? snap?.best.side ?? "long";
  const v = snap ? snap[cur] : null;
  const cfg = snap?.cfg ?? DEFAULT_SIGNAL_CFG;
  const fresh = useFreshEntry(snap);
  const rungs = snap && v ? rungViews(snap, v, cur, cfg) : [];
  const parts = v ? partViews(v) : [];
  const freshRungs = useFreshRungs(rungs, cur);
  const pill = statusPill(check.state);
  const n = cfg.ladder.length;
  const badge = fresh.last;
  const body = useRef<HTMLDivElement>(null);
  useRememberHeight(body, !!(snap && v));

  return (
    <div id={SIGNAL_CARD_ID} className="scroll-mt-20" data-testid="signal-card" data-state={check.state}>
      <Card
        title={SIGNAL_TITLE}
        // while loading the note line is reserved (invisible), so the header keeps the evaluated card's height
        note={snap ? `live · ${ladderText(cfg.ladder)}` : check.state === "loading" ? <span className="invisible">live · {ladderText(cfg.ladder)}</span> : undefined}
        action={
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={pill.tone} expanded label={pill.label} title={check.message ?? undefined} />
            <Segmented<Side> size="sm" aria-label="Richtung" options={SIDE_OPTIONS} value={cur} onChange={setSide} tones={SIDE_TONES} />
            <Expander open={info} onToggle={() => setInfo((o) => !o)} label={SIGNAL_TITLE} controls={SIGNAL_INFO_ID} />
          </div>
        }
      >
        {badge && (
          <span aria-hidden="true" className="pointer-events-none absolute inset-0 rounded-[15px]">
            <BorderBeam fire={badge.seq} size={110} colorFrom={badge.side === "long" ? "#3ddc84" : "#ff4d4f"} />
          </span>
        )}
        {!snap || !v ? (
          check.state === "loading" ? (
            <SignalSkeleton rungs={n} message={check.message ?? LOADING_TEXT} />
          ) : (
            <div className="flex flex-wrap items-center gap-3 text-[13px] leading-relaxed text-mute">
              <p>{check.message ?? OFFLINE_TEXT}</p>
              <button type="button" onClick={refresh} disabled={disabled} className="touch-hit text-fg underline-offset-2 hover:underline disabled:opacity-50">
                {refreshing ? "Aktualisiere …" : "Jetzt aktualisieren"}
              </button>
            </div>
          )
        ) : (
          <div ref={body} className={cn("grid gap-5 transition-opacity duration-300", check.state === "stale" && "opacity-80")}>
            <BiasBar sig={snap} cfg={cfg} />
            <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.8fr)_2fr] xl:items-center">
              <div className="grid min-w-0 gap-3">
                <VerdictRow v={v} ladderLength={n} flash={fresh.n[cur]} line={verdictStateLine(snap, v, cfg)} />
                <NoLayoutCascade>
                  <AnimatePresence initial={false}>
                    {badge && (
                      <motion.div key={badge.seq} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: tween.fade }} exit={{ opacity: 0, transition: tween.exit }}>
                        <FreshBadge side={badge.side} current={cur} onShow={() => setSide(badge.side)} />
                      </motion.div>
                    )}
                  </AnimatePresence>
                </NoLayoutCascade>
              </div>
              <div
                className="grid grid-cols-2 gap-2 sm:grid-cols-[repeat(var(--rungs),minmax(0,1fr))]"
                style={{ "--rungs": Math.max(1, rungs.length) } as CSSProperties}
                aria-label="Timeframe-Leiter"
                role="list"
              >
                {rungs.map((r) => (
                  <div key={r.tf} role="listitem" className="min-w-0">
                    <RungTile rung={r} side={cur} cfg={cfg} fresh={r.match && freshRungs.has(rungKey(r))} />
                  </div>
                ))}
              </div>
            </div>
            <PartsSection parts={parts} side={cur} cfg={cfg} points={v.partPoints ?? 0} />
            <div className="grid gap-5 md:grid-cols-[1.1fr_1fr]">
              <ZoneGauge c={snap.zone} side={cur} />
              <Reasons v={v} />
            </div>
            {check.state === "stale" && check.message && <p className="text-[11.5px] text-warn">{check.message}</p>}
            <p className="text-[11px] leading-snug text-faint">{DATA_SOURCE_NOTE}</p>
          </div>
        )}
        <Collapse open={info} id={SIGNAL_INFO_ID}>
          <Explainer d={infoData(snap)} />
        </Collapse>
      </Card>
    </div>
  );
}

/**
 * `Neuer Long-Einstieg` marker: wipes in (pulse `tactile-highlight`, invert tone) when a fresh entry appears; on the
 * other side than the one shown it is a button that switches to it.
 */
function FreshBadge({ side, current, onShow }: { side: Side; current: Side; onShow: () => void }) {
  const [on, setOn] = useState(false);
  // wipe in on the frame after mount (the marker needs its box measured first)
  useEffect(() => {
    const id = requestAnimationFrame(() => setOn(true));
    return () => cancelAnimationFrame(id);
  }, []);
  const label = (
    // the label look without `.label`'s own colour: the base copy inherits mute, the lit copy the highlight's ink
    <TactileHighlight active={on} tab={false} padX={0.4} className="text-mute">
      <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.14em]">{FRESH_ENTRY_TEXT[side]}</span>
    </TactileHighlight>
  );
  return (
    <div className="flex items-center gap-2" data-testid="signal-fresh">
      {side === current ? (
        label
      ) : (
        <button type="button" onClick={onShow} className="touch-hit rounded-md">
          {label}
          <span className="ml-2 text-[11px] text-mute">anzeigen</span>
        </button>
      )}
    </div>
  );
}
