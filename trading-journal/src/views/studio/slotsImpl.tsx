/**
 * The two panels of the Strategie-Studio's "Mehr Werkzeuge" (`Slots.tsx`): the pattern discovery of the backtest the studio just ran,
 * and the background optimiser for this strategy (and the other saved ones, as a tournament on the same candles). Both are the
 * panels the Labor uses; the studio only decides what they look at and what their buttons do:
 *
 * - Muster entdecken: the trades of the shown backtest with its candles. No "Mit diesem Filter testen" here – a pattern becomes an
 *   extra filter of the Labor's comparison, not a rule of this text; the finding says so in its own words.
 * - Weiterentwickeln: "Als neue Version speichern" does not write anything: it shows the proposal in the studio (the same box a
 *   proposal of any panel lands in) and the trader applies exactly that change with "Übernehmen" and saves the version himself.
 *   "Als Herausforderer live testen" starts a paper account (forward test) with the proposal's rules, after the click.
 */
import { lazy, Suspense, useMemo } from "react";
import { HIST_MS, type HistInterval } from "@/domain/backtest/index";
import { fromBacktest } from "@/domain/discovery/adapters";
import { studioCfgOf } from "@/domain/strategytext";
import { useJournal } from "@/store/journalStore";
import { startProposalAsChallenger } from "@/views/evolve/labHost";
import type { EvolveActionResult } from "@/views/evolve/types";
import type { StudioPanelProps } from "./types";

const DiscoveryPanel = lazy(() => import("@/views/discovery/DiscoveryPanel"));
const EvolveSection = lazy(() => import("@/views/evolve/EvolveSection"));

const MAX_STRATEGIES = 6;

function Note({ id, title, text }: { id: string; title: string; text: string }) {
  return (
    <div className="grid gap-1.5 rounded-xl border border-dashed border-line-2 bg-ink-950/40 p-4" data-testid={id} data-state="empty">
      <h3 className="label !text-mute">{title}</h3>
      <p className="text-[12px] text-faint">{text}</p>
    </div>
  );
}

function Loading({ id }: { id: string }) {
  return (
    <div className="rounded-xl border border-line-2 bg-ink-950/40 p-4 text-[12px] text-faint" data-testid={id} data-state="loading" role="status">
      Wird geladen …
    </div>
  );
}

export function DiscoveryPanelImpl({ strategy, candles, result }: StudioPanelProps) {
  const input = useMemo(() => {
    if (!result || !candles || candles.length === 0) return null;
    const ms = HIST_MS[result.interval as HistInterval];
    if (!ms) return null;
    return fromBacktest(result.trades, candles, ms / 1000, { label: `${strategy.symbol} ${result.interval} · ${strategy.name || "Strategie"}` });
  }, [result, candles, strategy.symbol, strategy.name]);

  if (!input) return <Note id="studio-discovery" title="Muster entdecken" text="Lass zuerst einen Backtest laufen. Dann suche ich in seinen Trades nach Zusammenhängen – und sage dir, wie viele ich geprüft habe und welche dem Zufall nicht standhalten." />;
  return (
    <div data-testid="studio-discovery" data-state="ready">
      <Suspense fallback={<Loading id="studio-discovery-loading" />}>
        <DiscoveryPanel trades={input.trades} {...(input.markets ? { markets: input.markets } : {})} source="backtest" {...(input.label ? { label: input.label } : {})} bare />
      </Suspense>
    </div>
  );
}

export function EvolvePanelImpl({ strategy, onPropose }: StudioPanelProps) {
  const raw = useJournal((s) => s.settings.studio);
  const currentId = strategy.id ?? "studio-draft";
  const configs = useMemo(() => {
    const list: { id: string; name: string; config: StudioPanelProps["strategy"]["rules"]; label?: string }[] = [{ id: currentId, name: `${strategy.name || "Neue Strategie"} (im Editor)`, config: strategy.rules }];
    for (const s of studioCfgOf(raw).strategies) {
      if (list.length >= MAX_STRATEGIES) break;
      const latest = s.versions.at(-1);
      if (s.id === strategy.id || !latest) continue;
      list.push({ id: s.id, name: s.name, config: latest.config, label: `Version ${latest.n}` });
    }
    return list;
  }, [raw, currentId, strategy.id, strategy.name, strategy.rules]);

  const propose = (_entry: unknown, p: { config: StudioPanelProps["strategy"]["rules"]; changes: readonly string[] }): EvolveActionResult => {
    if (!onPropose) return { ok: false, reason: "Dieses Fenster kann keinen Vorschlag übernehmen." };
    onPropose({ config: p.config, note: `Vorschlag des Optimierers: ${p.changes.slice(0, 3).join("; ")}`.slice(0, 240) });
    return { ok: true, label: "als Vorschlag im Editor angezeigt – dort „Übernehmen“ wählen und die Version speichern" };
  };

  return (
    <Suspense fallback={<Loading id="studio-evolve-loading" />}>
      <div data-testid="studio-evolve" data-state="ready">
        <EvolveSection configs={configs} symbol={strategy.symbol} period={strategy.period} onSaveVersion={(e, p) => propose(e, p)} onStartChallenger={startProposalAsChallenger} defaultSelected={[currentId]} />
      </div>
    </Suspense>
  );
}
