import { AnimatePresence, motion } from "motion/react";
import { useEffect, useState, type CSSProperties } from "react";
import { DATA_SOURCE_NOTE, DEFAULT_SIGNAL_CFG, LOADING_TEXT, OFFLINE_TEXT, SIGNAL_TITLE, signalInfo, type Side } from "@/domain/signals";
import { cn } from "@/lib/cn";
import { SIGNAL_HOLD_MS, useSignalCheck, type LiveSignals } from "@/market";
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
import { Reasons, RungTile, VerdictRow, WhaleRow, ZoneGauge } from "./signalParts";
import { entryLevels, freshEntry, ladderText, rungViews, statusPill, whaleView, type EntryLevels, type RungView } from "./signalView";
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
function SignalSkeleton({ rungs }: { rungs: number }) {
  return (
    <div className="grid gap-5" aria-hidden="true">
      <div className="flex items-center gap-5">
        <Skeleton className="size-[86px] rounded-full" />
        <div className="grid flex-1 gap-2">
          <Skeleton className="h-5 w-48 max-w-full rounded-md" />
          <Skeleton className="h-3 w-40 max-w-full rounded-md" />
        </div>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {Array.from({ length: rungs }, (_, i) => (
          <Skeleton key={i} className="h-[132px]" />
        ))}
      </div>
    </div>
  );
}

/**
 * `Einstiegs-Check` (other journal's `signalpanel.tsx`, on Binance data): verdict ring + label + strength, the
 * timeframe ladder (MCB event, MCB and RSI meters per rung), the "Top-Trader kaufen · Retail rot" row (ours), the
 * Premium/Discount zone with the live price, and the reasons. Reads `useSignalCheck()` – the engine evaluates ≤ 1/s off the render path and publishes only real changes,
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
  const whale = snap ? whaleView(snap, cur, cfg) : null;
  const freshRungs = useFreshRungs(rungs, cur);
  const pill = statusPill(check.state);
  const n = cfg.ladder.length;
  const badge = fresh.last;

  return (
    <div id={SIGNAL_CARD_ID} className="scroll-mt-20" data-testid="signal-card" data-state={check.state}>
      <Card
        title={SIGNAL_TITLE}
        note={snap ? `live · ${ladderText(cfg.ladder)}` : undefined}
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
          <div className="grid gap-4">
            {check.state === "loading" ? (
              <TextShimmer as="p" className="text-[13px] leading-relaxed">
                {check.message ?? LOADING_TEXT}
              </TextShimmer>
            ) : (
              <div className="flex flex-wrap items-center gap-3 text-[13px] leading-relaxed text-mute">
                <p>{check.message ?? OFFLINE_TEXT}</p>
                <button type="button" onClick={refresh} disabled={disabled} className="touch-hit text-fg underline-offset-2 hover:underline disabled:opacity-50">
                  {refreshing ? "Aktualisiere …" : "Jetzt aktualisieren"}
                </button>
              </div>
            )}
            {check.state === "loading" && <SignalSkeleton rungs={n} />}
          </div>
        ) : (
          <div className={cn("grid gap-5 transition-opacity duration-300", check.state === "stale" && "opacity-80")}>
            <div className="grid gap-5 xl:grid-cols-[minmax(280px,0.8fr)_2fr] xl:items-center">
              <div className="grid min-w-0 gap-3">
                <VerdictRow v={v} ladderLength={n} flash={fresh.n[cur]} />
                <AnimatePresence initial={false}>
                  {badge && (
                    <motion.div key={badge.seq} initial={{ opacity: 0 }} animate={{ opacity: 1, transition: tween.fade }} exit={{ opacity: 0, transition: tween.exit }}>
                      <FreshBadge side={badge.side} current={cur} onShow={() => setSide(badge.side)} />
                    </motion.div>
                  )}
                </AnimatePresence>
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
            {whale?.on && <WhaleRow w={whale} side={cur} />}
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
    <TactileHighlight active={on} tab={false} padX={0.4}>
      <span className="label !text-[10.5px]">{FRESH_ENTRY_TEXT[side]}</span>
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
