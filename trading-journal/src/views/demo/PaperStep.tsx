/**
 * Step 4 – Demokonto: one paper trade as a game. Choose side, stop and target at the decision candle, then reveal the candles one
 * by one; the engine (`playPaper`) recomputes from the candles revealed so far – it can never see further. Opening a position
 * here only means „play along“: there is no order, no broker, nothing is saved.
 */
import { useMemo } from "react";
import { n2, price as fmtPrice, r as fmtR, signed } from "@/lib/format";
import { demoHourly } from "@/domain/demo/candles";
import { PAPER_ENGINE, PAPER_LOOKBACK, PAPER_MAX_AFTER, PAPER_SCENE, paperVerdict, playPaper, type PaperPlan } from "@/domain/demo/paper";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Field } from "@/primitives/Field";
import { Segmented } from "@/primitives/Segmented";
import { DemoCard, Fig } from "./DemoCard";
import { DemoChart, type ChartLine } from "./DemoChart";
import { patch, useSession } from "./session";
import { PAPER } from "./strings";

export function PaperStep() {
  const plan = useSession((s) => s.paper);
  const shown = useSession((s) => s.paperShown);
  const started = shown != null;
  const set = (p: Partial<PaperPlan>): void => patch({ paper: { ...plan, ...p } });
  const view = useMemo(() => playPaper(plan, shown ?? 0), [plan, shown]);
  const bars = useMemo(() => {
    const all = demoHourly();
    return all.slice(PAPER_SCENE - PAPER_LOOKBACK, view.lastIndex + 1);
  }, [view.lastIndex]);
  const lv = view.levels;
  const lines: ChartLine[] = [
    { price: lv.stop, label: PAPER.levels.stop, tone: "stop" },
    { price: lv.target, label: PAPER.levels.target, tone: "target" },
    ...(view.open ? [{ price: view.open.entry, label: PAPER.levels.entry, tone: "entry" as const }] : view.trade ? [{ price: view.trade.entry, label: PAPER.levels.entry, tone: "entry" as const }] : [{ price: lv.close, label: "Entscheidung", tone: "entry" as const }]),
  ];
  const t = view.trade;
  const tone = view.state === "closed" ? "steel" : view.state === "open" ? "teal" : "mute";
  return (
    <DemoCard step="konto" title={PAPER.title} lead={PAPER.lead} candles>
      <div className="grid gap-3.5 sm:grid-cols-3" data-testid="demo-paper-form">
        <Field label={PAPER.side}>
          <Segmented<PaperPlan["side"]>
            size="sm"
            aria-label={PAPER.side}
            value={plan.side}
            onChange={(v) => set({ side: v })}
            options={[
              { v: "long", label: "Long", disabled: started },
              { v: "short", label: "Short", disabled: started },
            ]}
          />
        </Field>
        <Field label={PAPER.stop}>
          <Segmented<"1" | "1.5" | "2">
            size="sm"
            aria-label={PAPER.stop}
            value={String(plan.stopAtr) as "1" | "1.5" | "2"}
            onChange={(v) => set({ stopAtr: Number(v) as PaperPlan["stopAtr"] })}
            options={(["1", "1.5", "2"] as const).map((v) => ({ v, label: v.replace(".", ","), disabled: started }))}
          />
        </Field>
        <Field label={PAPER.target}>
          <Segmented<"1" | "2" | "3">
            size="sm"
            aria-label={PAPER.target}
            value={String(plan.targetR) as "1" | "2" | "3"}
            onChange={(v) => set({ targetR: Number(v) as PaperPlan["targetR"] })}
            options={(["1", "2", "3"] as const).map((v) => ({ v, label: `${v} R`, disabled: started }))}
          />
        </Field>
      </div>

      <div className="flex flex-wrap items-center gap-2.5">
        {!started ? (
          <Button variant="primary" onClick={() => patch({ paperShown: 0 })} data-testid="demo-paper-open">
            {PAPER.open}
          </Button>
        ) : (
          <>
            <Button variant="primary" onClick={() => patch({ paperShown: Math.min(PAPER_MAX_AFTER, (shown ?? 0) + 1) })} disabled={view.state === "closed" || (shown ?? 0) >= PAPER_MAX_AFTER} data-testid="demo-paper-next">
              {PAPER.next}
            </Button>
            <Button
              onClick={() => {
                let k = shown ?? 0;
                while (k < PAPER_MAX_AFTER && playPaper(plan, k).state !== "closed") k++;
                patch({ paperShown: k });
              }}
              disabled={view.state === "closed"}
              data-testid="demo-paper-run"
            >
              {PAPER.run}
            </Button>
            <Button size="sm" onClick={() => patch({ paperShown: null })} data-testid="demo-paper-reset">
              {PAPER.reopen}
            </Button>
          </>
        )}
        {started && (
          <>
            <Badge tone={tone} dot>
              {PAPER.state[view.state]}
            </Badge>
            <span className="text-[12px] text-mute" data-testid="demo-paper-shown">
              {PAPER.shown(view.shown)}
            </span>
          </>
        )}
      </div>

      <DemoChart bars={bars} lines={lines} label={PAPER.chartLabel} testId="demo-paper-chart" />

      <div className="grid grid-cols-3 gap-2" data-testid="demo-paper-levels">
        <Fig label={PAPER.levels.entry} value={fmtPrice(view.open?.entry ?? t?.entry ?? lv.close)} sub={view.state === "waiting" ? "Schluss der Entscheidungskerze" : "gefüllt zur Eröffnung"} />
        <Fig label={PAPER.levels.stop} value={fmtPrice(lv.stop)} tone="loss" sub={`${n2(lv.risk)} Abstand`} />
        <Fig label={PAPER.levels.target} value={fmtPrice(lv.target)} tone="win" sub={`${plan.targetR} R`} />
      </div>

      {started && (
        <section className="grid gap-2" aria-label={PAPER.result} data-testid="demo-paper-result" data-state={view.state}>
          <h3 className="label">{PAPER.result}</h3>
          <p className="text-[13px] leading-relaxed text-fg" role="status" aria-live="polite" data-testid="demo-paper-verdict">
            {view.state === "waiting" ? PAPER.waiting : view.state === "open" && view.open ? PAPER.openNow(fmtR(view.open.r).replace(" R", "")) : paperVerdict(view)}
          </p>
          {t && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Fig label={PAPER.tiles.r} value={fmtR(t.r)} tone={t.r > 0 ? "win" : t.r < 0 ? "loss" : undefined} testId="demo-paper-r" />
              <Fig label={PAPER.tiles.pnl} value={signed(t.pnl, 2)} sub={`Konto ${n2(PAPER_ENGINE.capital)}`} tone={t.pnl > 0 ? "win" : t.pnl < 0 ? "loss" : undefined} />
              <Fig label={PAPER.tiles.fees} value={n2(t.fees)} sub={`Slippage ${n2(t.slippage)}`} />
              <Fig label={PAPER.tiles.bars} value={`${t.bars}`} sub={t.bars === 1 ? "Kerze" : "Kerzen"} />
            </div>
          )}
          <p className="max-w-[68ch] text-[12px] leading-relaxed text-mute">{PAPER.note}</p>
          <p className="max-w-[68ch] text-[12px] leading-relaxed text-mute">{PAPER.forward}</p>
        </section>
      )}
    </DemoCard>
  );
}
