import { useMemo, useState } from "react";
import { ACCOUNT_LABELS } from "@/domain/defaults";
import { explain, HERO_TILES, heroSubline, heroTileValue, type ExplainKey } from "@/domain/explain";
import { cn } from "@/lib/cn";
import { colorClass, n0, pct } from "@/lib/format";
import { MorphCard } from "@/motion/MorphCard";
import { MotionNumber, useAnimatedNumber } from "@/motion/MotionNumber";
import { radius } from "@/motion/tokens";
import { Badge } from "@/primitives/Badge";
import { HeroBackdrop } from "@/primitives/HeroBackdrop";
import { Segmented } from "@/primitives/Segmented";
import { StatTile } from "@/primitives/StatTile";
import { useAccountView, useJournal } from "@/store/journalStore";
import { useUi, type AccFilter } from "@/store/uiStore";
import { ExplanationView } from "./explainer";
import { MarketPanel } from "./MarketPanel";

const ACC_OPTIONS = (["all", "makro", "scalp"] as const).map((v) => ({ v, label: ACCOUNT_LABELS[v] }));
/** NEW (Plan 6.1): sixth/seventh tile on `xl` only – both explainers existed in `Jl` but were never wired. */
const XL_TILES: readonly { key: ExplainKey; label: string }[] = [
  { key: "exp", label: "Erwartungswert" },
  { key: "streak", label: "Serie" },
];

/**
 * Hero (Bundle `yhe`, Plan 6.1): account Segmented → `uiStore.acc`, `Startkapital`, Netto-P&L `MotionNumber`
 * (shared MotionValue with the `Details +` fact dialog), subline, KPI strip of `StatTile`s (`morph-fact-{key}`),
 * right column `MarketPanel`.
 */
export function Hero() {
  const acc = useUi((s) => s.acc);
  const setAcc = useUi((s) => s.setAcc);
  const settings = useJournal((s) => s.settings);
  const loaded = useJournal((s) => s.loaded);
  const view = useAccountView(acc);
  const g = view.g;
  const cur = settings.currency;
  const ret = view.start ? g.net / view.start : null;
  const [active, setActive] = useState<number | null>(null);
  const net = useAnimatedNumber(loaded ? g.net : 0);

  const tiles = useMemo(() => [...HERO_TILES.map((t) => ({ ...t, xl: false })), ...XL_TILES.map((t) => ({ ...t, xl: true }))], []);

  return (
    <section className="relative overflow-hidden rounded-[28px] border border-line" aria-labelledby="hero-net-label">
      <HeroBackdrop />
      <div className="relative grid gap-6 p-5 sm:p-7 lg:grid-cols-[1.3fr_1fr] lg:gap-8 lg:p-8">
        <div className="flex min-w-0 flex-col justify-between gap-7">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <Segmented<AccFilter> aria-label="Konto" options={ACC_OPTIONS} value={acc} onChange={setAcc} />
            <span className="text-xs text-mute">
              Startkapital {n0(view.start)} {cur}
            </span>
          </div>
          <div>
            <div className="mb-3 flex items-center gap-3">
              <span id="hero-net-label" className="label">
                Netto-P&L · {ACCOUNT_LABELS[acc]}
              </span>
              <MorphCard
                id="fact-net"
                title="Netto-P&L"
                borderRadius={radius.pill}
                className="!w-auto rounded-full border border-line-2 px-2.5 py-0.5 hover:border-white/50"
                body={() => (
                  <div className="grid gap-4">
                    <div className={cn("dot-num text-[34px] leading-none", colorClass(g.net))}>
                      <MotionNumber source={net} decimals={2} signed aria-label={heroTileValue("net", view)} /> <span className="font-sans text-base font-medium text-mute">{cur}</span>
                    </div>
                    <ExplanationView bare d={explain("net", view, settings)} />
                  </div>
                )}
              >
                <span className="label !text-[9.5px] group-hover:!text-fg">Details +</span>
              </MorphCard>
            </div>
            <div className={cn("dot-num flex flex-wrap items-baseline gap-x-3 text-[clamp(44px,8vw,78px)] leading-none", colorClass(g.net))} data-testid="hero-net">
              {loaded ? <MotionNumber source={net} decimals={2} signed aria-label={heroTileValue("net", view)} /> : <span className="text-faint">0,00</span>}
              <span className="font-sans text-lg font-medium text-mute">{cur}</span>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-sm text-mute">
              {ret != null && g.n > 0 && <Badge tone={ret >= 0 ? "win" : "loss"}>{pct(ret)}</Badge>}
              <span>{heroSubline(view)}</span>
            </div>
          </div>
          <dl className="grid grid-cols-2 gap-2 border-t border-white/10 pt-5 sm:flex" onMouseLeave={() => setActive(null)}>
            {tiles.map((t, i) => {
              const d = explain(t.key, view, settings);
              const value =
                t.key === "trades" ? (
                  <>
                    {g.n}
                    {view.open.length ? <span className="text-faint"> +{view.open.length} offen</span> : null}
                  </>
                ) : t.key === "exp" ? (
                  `${heroTileValue("exp", view)}${g.exp == null ? "" : ` ${cur}`}`
                ) : t.key === "streak" ? (
                  view.streak ? `${view.streak}× ${view.streakType === "win" ? "Gewinn" : view.streakType === "loss" ? "Verlust" : "Break-even"}` : "–"
                ) : (
                  heroTileValue(t.key, view)
                );
              return (
                <StatTile
                  key={t.key}
                  fact={t.key}
                  label={t.label}
                  value={value}
                  verdict={d.verdict}
                  active={active === i}
                  onActivate={() => setActive(i)}
                  body={() => <ExplanationView bare d={d} />}
                  className={t.xl ? "hidden xl:block" : undefined}
                />
              );
            })}
          </dl>
        </div>
        <MarketPanel />
      </div>
    </section>
  );
}
