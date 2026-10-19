/**
 * `Beste Setups` (P02): only the A+ / A Box-zu-Box setups of the live symbol across 4h / 1D / 1W, best score first –
 * "trade the best, fuck the rest". Each setup is a MorphCard (→ dialog with every reason and its weight, the plan with
 * entry, stop, targets and CRV, the higher timeframe, and the two ways on: `Als Trade eintragen` / `Im Rechner öffnen`).
 *
 * Motion: the cards are dealt in (`CardSpread`, on first view and when the set changes); the grade glows in dot-matrix
 * digits (`A+` with the red bloom); a breakout / retest card runs one `BorderBeam` lap, shoots `BreakoutStreak` chevrons
 * in the breakout direction, marks `Ausbruch ↑` (`TactileHighlight`) and decodes the broken level (`TextScramble`); the
 * distance of the live price to the setup's edge rolls (`RollingDigits` on `priceMv`, zero renders per tick).
 * Reduced motion: every end state at once.
 */
import { themePaint } from "@/lib/themePaint";
import { motion } from "motion/react";
import { memo, useMemo } from "react";
import { KIND_TEXT, PHASE_LABEL, normalizeWatchSymbol, toBoxSnapshot, type BoxSetup } from "@/domain/boxes";
import { nowLocalInput } from "@/lib/dates";
import { useMorphDialog } from "@/motion/MorphDialog";
import { Button } from "@/primitives/Button";
import { useJournal } from "@/store/journalStore";
import { navigate } from "@/store/router";
import { useUi } from "@/store/uiStore";
import { toInput, useRiskUi } from "@/views/risiko/riskStore";
import { TestIdeaButton } from "@/views/labor/TestIdeaButton";
import { cn } from "@/lib/cn";
import type { BestSetup, BoxesView } from "@/market/boxes/store";
import { BreakoutStreak } from "@/motion/fx/BreakoutStreak";
import { ConfidenceMeter } from "@/motion/fx/ConfidenceMeter";
import { MorphCard, MorphTitle } from "@/motion/MorphCard";
import { CardSpread } from "@/motion/pulse/CardSpread";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { StaggerItem } from "@/motion/Stagger";
import { TextScramble } from "@/motion/TextScramble";
import { stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { BorderBeam } from "@/primitives/BorderBeam";
import { Card } from "@/primitives/Card";
import { DotMatrix } from "@/motion/DotMatrix";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { MARKT, TF_TEXT } from "./strings";
import { EdgeDistance, GradeMatrix, TfChip, edgeOf, price, rrText } from "./ui";

const S = MARKT.best;
/** Small stable string hash (FNV-1a) – a numeric replay key for the deal. */
export function hashIds(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 0x01000193);
  return h >>> 0;
}
const isBreak = (s: BoxSetup): boolean => s.kind === "breakout" || s.kind === "retest";

/**
 * The two ways out of a setup (review F2: the dialog used to end in "Schließen"): `Im Rechner öffnen` hands side,
 * entry, stop and target 1 to the risk calculator (programmatic fill → its results cascade in) and switches to Risiko;
 * `Als Trade eintragen` opens the trade editor pre-filled (`openEditor({ draft })`) with the setup's box context as
 * `boxSnap` – the editor keeps a draft's own snapshot. Both close the dialog first (its reverse morph runs, a page switch
 * from inside the dialog is handled by the MorphCard).
 */
function SetupActions({ b, symbol }: { b: BestSetup; symbol: string | null }) {
  const { close } = useMorphDialog();
  const journalPair = useJournal((st) => st.settings.pair);
  const s = b.setup;
  // the journal's own spelling ("BTC/USDT") when it is this symbol, else the venue symbol itself
  const pair = symbol && normalizeWatchSymbol(journalPair) !== symbol ? symbol : journalPair;
  const t1 = s.targets[0]?.price ?? null;
  const toCalc = () => {
    useRiskUi.getState().setCalc({ side: s.side, pair, entry: toInput(s.entry), stop: toInput(s.stop), target: t1 != null ? toInput(t1) : "" }, true);
    close();
    navigate("risiko");
  };
  const toTrade = () => {
    close();
    useUi.getState().openEditor({
      draft: {
        side: s.side,
        status: "open",
        date: nowLocalInput(),
        pair,
        timeframe: TF_TEXT[b.tf],
        entry: s.entry,
        stop: s.stop,
        target: t1,
        ...(symbol ? { boxSnap: toBoxSnapshot(b.analysis, { symbol, tf: b.tf, side: s.side, source: "live" }) } : {}),
      },
    });
  };
  return (
    <StaggerItem as="section" className="grid gap-2" data-testid="setup-actions">
      <div className="flex flex-wrap gap-2">
        <Button variant="primary" onClick={toTrade} data-testid="setup-to-trade">
          {S.toTrade}
        </Button>
        <Button variant="ghost" onClick={toCalc} data-testid="setup-to-calc">
          {S.toCalc}
        </Button>
        <TestIdeaButton
          input={{ kind: "box", symbol, tf: b.tf, setup: s, boxBars: b.analysis.box.box ? b.analysis.box.box.i1 - b.analysis.box.box.i0 + 1 : null }}
          onOpen={close}
          testId="setup-to-lab"
        />
      </div>
      <p className="text-[11.5px] leading-snug text-faint">{S.actionsNote}</p>
    </StaggerItem>
  );
}

/** Dialog body: what the grade is made of, the plan, the higher timeframe, and the way into a trade. */
export function SetupExplain({ b, symbol = null }: { b: BestSetup; symbol?: string | null }) {
  const s = b.setup;
  const reduced = useReducedFx();
  const max = Math.max(...s.reasons.map((r) => r.weight), 1);
  const box = b.analysis.box.box;
  const htf = b.analysis.htf;
  return (
    <div className="grid gap-4" data-testid="setup-explain">
      <StaggerItem className="flex flex-wrap items-center gap-3">
        <GradeMatrix grade={s.grade} size={5} />
        <span className="grid gap-0.5">
          <span className="text-[15px] font-semibold">{s.title}</span>
          <span className="text-[12px] text-mute">
            {TF_TEXT[b.tf]} · {PHASE_LABEL[b.analysis.box.phase]} · {S.score} {s.score}
          </span>
        </span>
      </StaggerItem>
      <StaggerItem as="section" className="grid gap-2">
        <h3 className="label">{S.reasons}</h3>
        <ul className="grid gap-1.5">
          {s.reasons.map((r, i) => (
            <li key={r.text} className="grid grid-cols-[auto_minmax(0,1fr)_64px] items-center gap-2.5 rounded-xl border border-line bg-ink-950/40 px-3 py-2" data-ok={r.ok ? "true" : "false"}>
              <span aria-hidden="true" className={cn("grid size-5 place-items-center rounded-full text-[11px] font-bold", r.ok ? "bg-win/20 text-win" : "bg-white/[0.06] text-faint")}>
                {r.ok ? "✓" : "–"}
              </span>
              <span className={cn("text-[12.5px] leading-snug", r.ok ? "text-fg" : "text-mute")}>
                <span className="sr-only">{r.ok ? "erfüllt: " : "offen: "}</span>
                {r.text}
              </span>
              <span className="grid gap-1" title={`${S.weight} ${r.weight}`}>
                <span className="num text-right font-mono text-[10.5px] text-faint">{r.weight}</span>
                <span className="relative h-1 overflow-hidden rounded-full bg-white/[0.06]" aria-hidden="true">
                  <motion.span
                    className={cn("absolute inset-0 origin-left rounded-full", r.ok ? "bg-win" : "bg-white/20")}
                    initial={reduced ? false : { scaleX: 0 }}
                    animate={{ scaleX: r.weight / max }}
                    transition={{ ...tween.bar, delay: reduced ? 0 : Math.min(i, stagger.max) * stagger.rows }}
                  />
                </span>
              </span>
            </li>
          ))}
        </ul>
      </StaggerItem>
      <StaggerItem as="section" className="grid gap-2">
        <h3 className="label">{S.plan}</h3>
        <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          <PlanTile k={S.entry} v={price(s.entry)} />
          <PlanTile k={S.stop} v={price(s.stop)} tone="loss" />
          <PlanTile k={`${S.target} 1`} v={price(s.targets[0]?.price)} tone="win" />
          <PlanTile k={S.rr} v={rrText(s.rr)} />
        </dl>
        {s.targets.length > 0 && (
          <ul className="grid gap-1 text-[12px] text-mute">
            {s.targets.map((t, i) => (
              <li key={`${t.price}-${i}`} className="flex flex-wrap gap-x-2">
                <span className="num font-mono text-fg">T{i + 1} {price(t.price)}</span>
                <span>{t.label}</span>
              </li>
            ))}
          </ul>
        )}
        <p className="text-[12.5px] leading-relaxed text-mute">{s.detail}</p>
      </StaggerItem>
      {(box || htf) && (
        <StaggerItem as="section" className="grid gap-1 rounded-xl border border-line-2 bg-white/[0.02] px-3 py-2.5 text-[12px] text-mute">
          {box && (
            <span>
              Box {price(box.bottom)} – {price(box.top)} · {box.grade} ({box.touchesTop}× oben, {box.touchesBottom}× unten)
            </span>
          )}
          {htf && (
            <span>
              {S.htf} {TF_TEXT[htf.tf as keyof typeof TF_TEXT] ?? htf.tf}: {PHASE_LABEL[htf.phase]}
            </span>
          )}
        </StaggerItem>
      )}
      <SetupActions b={b} symbol={symbol} />
    </div>
  );
}

function PlanTile({ k, v, tone }: { k: string; v: string; tone?: "win" | "loss" }) {
  return (
    <div className="rounded-xl border border-line bg-ink-950/30 px-3 py-2">
      <dt className="label !text-[9.5px]">{k}</dt>
      <dd className={cn("num mt-0.5 font-mono text-[14px]", tone === "win" && "text-win", tone === "loss" && "text-loss")}>{v}</dd>
    </div>
  );
}

/** One setup card (the MorphCard source). */
const SetupTile = memo(function SetupTile({ b, symbol }: { b: BestSetup; symbol: string | null }) {
  const s = b.setup;
  const box = b.analysis.box.box;
  const brk = isBreak(s);
  const up = s.side === "long";
  const edge = box ? edgeOf(s, box) : null;
  const id = `box-setup-${b.id}`;
  return (
    <MorphCard id={id} title={s.title} body={() => <SetupExplain b={b} symbol={symbol} />} className="@container relative h-full overflow-hidden rounded-2xl border border-line-2 bg-ink-950/40 p-4 text-left hover:border-white/30">
      <div className="relative grid gap-3.5" data-testid="best-setup" data-grade={s.grade} data-kind={s.kind} data-side={s.side}>
        {brk && (
          <span aria-hidden="true" className="pointer-events-none absolute -inset-4">
            <BreakoutStreak direction={up ? "up" : "down"} tone={up ? "win" : "loss"} count={22} seed={s.score} />
          </span>
        )}
        <div className="flex items-start gap-3.5">
          <GradeMatrix grade={s.grade} size={5} className="shrink-0" />
          <div className="grid min-w-0 flex-1 gap-1">
            <MorphTitle id={id} as="span" className="text-[15px] font-semibold leading-tight">
              {brk ? (
                <>
                  <TactileHighlight tone="invert" playOnView tab={false}>
                    {`${KIND_TEXT[s.kind]} ${up ? "↑" : "↓"}`}
                  </TactileHighlight>{" "}
                  {up ? "Long" : "Short"}
                </>
              ) : (
                s.title
              )}
            </MorphTitle>
            <span className="flex flex-wrap items-center gap-1.5 text-[12px] text-mute">
              <TfChip tf={b.tf} />
              <span className={cn("rounded-full border px-2 py-px text-[10.5px] font-semibold", up ? "border-win/35 text-win" : "border-loss/35 text-loss")}>{up ? "Long" : "Short"}</span>
              <span className="truncate">{PHASE_LABEL[b.analysis.box.phase]}</span>
            </span>
          </div>
        </div>
        {/* the tile's own width decides (two cards side by side at 1440 are ~330 px): 2 × 2 there, 4 × 1 at full width */}
        <dl className="grid grid-cols-2 gap-2 @md:grid-cols-4">
          <Metric k={S.entry} v={price(s.entry)} />
          <Metric k={S.stop} v={price(s.stop)} tone="loss" />
          <Metric k={S.target} v={price(s.targets[0]?.price)} tone="win" />
          <Metric k={S.rr} v={rrText(s.rr)} />
        </dl>
        <div className="flex flex-wrap items-end justify-between gap-x-4 gap-y-2 border-t border-line pt-3 text-[11.5px] text-mute">
          <span className="grid gap-1">
            {edge != null && (
              <span className="inline-flex items-center gap-1.5">
                {S.edge} <EdgeDistance edge={edge} className="text-[12.5px] text-fg" />
              </span>
            )}
            {brk && edge != null ? (
              <TextScramble text={`Kante ${price(edge)}`} className="num font-mono text-[11.5px] text-fg" />
            ) : box ? (
              <span className="num font-mono text-[11px] text-faint">
                Box {price(box.bottom)} – {price(box.top)}
              </span>
            ) : null}
          </span>
          <ConfidenceMeter value={s.score} label={S.score} size={3} gap={1.5} cols={16} rows={4} />
        </div>
      </div>
      {brk && <BorderBeam fire={b.id} colorFrom={up ? themePaint("#3ddc84") : themePaint("#ff4d4f")} colorTo="var(--color-white, #ffffff)" size={90} />}
    </MorphCard>
  );
});

function Metric({ k, v, tone }: { k: string; v: string; tone?: "win" | "loss" }) {
  return (
    <div className="min-w-0 rounded-xl border border-line bg-ink-950/50 px-2.5 py-1.5">
      <dt className="text-[10.5px] text-faint">{k}</dt>
      <dd className={cn("num truncate font-mono text-[13px] text-fg", tone === "win" && "text-win", tone === "loss" && "text-loss")}>{v}</dd>
    </div>
  );
}

/** The strongest non-best candidate (shown muted: what to watch, never as a trade). */
function watchOf(view: BoxesView): { tf: string; s: BoxSetup } | null {
  let out: { tf: string; s: BoxSetup } | null = null;
  for (const tf of ["4h", "1d", "1w"] as const) {
    const a = view.tfs[tf].analysis;
    for (const s of a?.setups ?? []) if (!s.best && (!out || s.score > out.s.score)) out = { tf: TF_TEXT[tf], s };
  }
  return out;
}

export function BestSetupsCard({ view }: { view: BoxesView }) {
  const best = view.best;
  // a new set of setups deals again (replay key = a hash of the ids)
  const deal = useMemo(() => hashIds(best.map((b) => b.id).join("|")), [best]);
  const watch = best.length ? null : watchOf(view);
  const loading = view.state === "loading" || view.state === "idle";
  return (
    <Card title={S.title} note={S.note} className="h-full" data-testid="markt-best">
      {view.state === "off" || view.state === "error" ? (
        <p className="text-[13px] text-mute">{view.detail}</p>
      ) : loading && !best.length ? (
        <div className="flex items-center gap-3 py-6 text-[13px] text-mute" data-testid="best-loading">
          <DotMatrix preset="loader" size={3} gap={2} label={S.loading} />
          <span>{view.detail ?? S.loading}</span>
        </div>
      ) : best.length ? (
        <CardSpread variant="deal" play={deal} className="grid grid-cols-[repeat(auto-fit,minmax(min(100%,300px),1fr))] gap-3" itemClassName="min-w-0" label={S.title}>
          {best.map((b) => (
            <SetupTile key={b.id} b={b} symbol={view.symbol} />
          ))}
        </CardSpread>
      ) : (
        <div className="grid gap-3 py-2" data-testid="best-empty">
          <div className="flex items-center gap-3">
            <DotMatrixText text="0" tone="mute" size={4} gap={2} glow={false} label="0 Setups" />
            <span className="grid gap-0.5">
              <span className="text-[14px] font-semibold">{S.empty}</span>
              <span className="text-[12.5px] text-mute">{S.emptyText}</span>
            </span>
          </div>
          {watch && (
            <p className="text-[12px] text-faint" data-testid="best-watch">
              {S.watch}: {watch.tf} · {watch.s.title} · {watch.s.grade} ({S.score} {watch.s.score})
            </p>
          )}
        </div>
      )}
    </Card>
  );
}
