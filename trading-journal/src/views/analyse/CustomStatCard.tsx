/**
 * Custom stat card (P03): build your own number – metric × filter (side, period, setup) × group-by – with a live
 * preview (value, 80 % interval, n, the groups as bars), save it into `settings.analytics.custom` (the journal's
 * settings: travels with backups and the cloud sync) and remove it again (the tile dissolves pixel by pixel –
 * `DissolveOut` – before the settings are written).
 */
import { motion } from "motion/react";
import { useMemo, useRef, useState } from "react";
import {
  ANA_EMPTY,
  CARD_TITLES,
  CUSTOM_MAX,
  CUSTOM_METRIC_ORDER,
  CUSTOM_METRICS,
  customStatsOf,
  customStatTitle,
  DIMENSION_ORDER,
  DIMENSIONS,
  evalCustomStat,
  explainCustom,
  SINCE_LABELS,
  withCustomStats,
  type CustomFormat,
  type CustomMetricKey,
  type CustomResult,
  type CustomSince,
  type CustomStat,
  type DimensionKey,
} from "@/domain/analytics";
import type { AccountView } from "@/domain/account";
import type { Settings } from "@/domain/types";
import { cn } from "@/lib/cn";
import { newId } from "@/lib/ids";
import { DASH, INFINITY_SIGN, n0, n2, pct0, r as fmtR, signed } from "@/lib/format";
import { DissolveOut } from "@/motion/fx/DissolveOut";
import { MorphSelect } from "@/motion/pulse/MorphSelect";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Button } from "@/primitives/Button";
import { DotFigure } from "@/primitives/DotUnit";
import { EmptyState } from "@/primitives/EmptyState";
import { useSeenOnce } from "@/primitives/revealValue";
import { Segmented } from "@/primitives/Segmented";
import { useJournal } from "@/store/journalStore";
import { pushToast } from "@/store/uiStore";
import { AnaCard, SEG_TOUCH, ciText } from "./ui";

type Side = "all" | "long" | "short";
const NONE = "__none";

export function formatCustom(v: number | null, f: CustomFormat, cur: string): string {
  if (v == null) return DASH;
  if (v === Infinity) return INFINITY_SIGN;
  switch (f) {
    case "int":
      return n0(v);
    case "pct":
      return pct0(v);
    case "money":
      return `${signed(v, 0)} ${cur}`;
    case "r":
      return fmtR(v);
    case "ratio":
      return n2(v);
    case "pctFine":
      return `${(v * 100).toLocaleString("de-DE", { minimumFractionDigits: 3, maximumFractionDigits: 3 })} %`;
  }
}

function GroupBars({ res, f, cur }: { res: CustomResult; f: CustomFormat; cur: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLUListElement>(null);
  const seen = useSeenOnce(ref);
  const groups = (res.groups ?? []).filter((g) => g.n > 0).slice(0, 6);
  const max = Math.max(1e-9, ...groups.map((g) => Math.abs(g.value != null && Number.isFinite(g.value) ? g.value : 0)));
  return (
    <ul ref={ref} className="grid gap-1">
      {groups.map((g, i) => {
        const v = g.value != null && Number.isFinite(g.value) ? g.value : 0;
        return (
          <li key={g.key} className="grid grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)_minmax(0,5.5rem)] items-center gap-2 text-[11.5px]">
            <span className="truncate text-mute">
              {g.label} <span className="text-faint">· {g.n}</span>
            </span>
            <span className="relative h-1.5 overflow-hidden rounded-full bg-white/[0.05]">
              <motion.span
                className={cn("absolute inset-y-0 left-0 w-full origin-left rounded-full", f === "int" || v >= 0 ? (f === "money" || f === "r" ? "bg-win/70" : "bg-white/45") : "bg-loss/70")}
                initial={reduced ? false : { scaleX: 0 }}
                animate={{ scaleX: seen || reduced ? Math.abs(v) / max : 0 }}
                transition={{ ...spring.enter, delay: reduced ? 0 : i * stagger.reveal }}
              />
            </span>
            <span className="num truncate text-right font-mono text-fg">{formatCustom(g.value, f, cur)}</span>
          </li>
        );
      })}
    </ul>
  );
}

function StatTileView({ stat, res, ctx, cur, onRemove }: { stat: CustomStat; res: CustomResult; ctx: { settings: Settings }; cur: string; onRemove: () => void }) {
  const [leaving, setLeaving] = useState(false);
  const m = CUSTOM_METRICS[stat.metric];
  return (
    <DissolveOut active={leaving} onDone={onRemove} as="li" className="grid content-start gap-2 rounded-2xl border border-line bg-ink-950/50 p-3">
      <div className="flex items-start justify-between gap-2" data-testid="custom-stat" data-id={stat.id}>
        <span className="min-w-0 text-[12.5px] font-medium leading-snug text-fg">{customStatTitle(stat, ctx)}</span>
        <button type="button" onClick={() => setLeaving(true)} disabled={leaving} className="touch-hit shrink-0 rounded-full border border-line-2 px-2 py-0.5 text-[11px] text-mute hover:text-loss" aria-label={`${customStatTitle(stat, ctx)} entfernen`}>
          Entfernen
        </button>
      </div>
      <div className="flex flex-wrap items-baseline gap-x-3">
        <span className="dot-num text-[26px] leading-none">
          <DotFigure text={formatCustom(res.value, m.format, cur)} />
        </span>
        <span className="num text-[11px] text-faint">
          n {res.n}
          {res.ci ? ` · 80 %: ${ciText(res.ci, m.format === "pct" ? "pct" : m.format === "r" ? "R" : m.format === "money" ? "money" : "ratio", cur)}` : ""}
        </span>
      </div>
      {res.groups && <GroupBars res={res} f={m.format} cur={cur} />}
    </DissolveOut>
  );
}

export function CustomStatCard({ view, settings, cur }: { view: AccountView; settings: Settings; cur: string }) {
  const [metric, setMetric] = useState<CustomMetricKey>("winRate");
  const [side, setSide] = useState<Side>("all");
  const [since, setSince] = useState<CustomSince>("all");
  const [setup, setSetup] = useState<string>(NONE);
  const [groupBy, setGroupBy] = useState<string>("session");
  const [now] = useState(() => Date.now());
  const ctx = useMemo(() => ({ settings }), [settings]);
  const saved = useMemo(() => customStatsOf(settings), [settings]);
  const draft: CustomStat = {
    id: "draft",
    metric,
    filter: { ...(side !== "all" ? { side } : {}), since, ...(setup !== NONE ? { dim: "setup" as const, key: setup } : {}) },
    groupBy: groupBy === NONE ? null : (groupBy as DimensionKey),
    createdAt: "",
  };
  const preview = evalCustomStat(view.closed, draft, ctx, view.start, now);
  const results = useMemo(() => saved.map((s) => evalCustomStat(view.closed, s, ctx, view.start, now)), [saved, view.closed, ctx, view.start, now]);
  const m = CUSTOM_METRICS[metric];
  const used = useMemo(() => settings.setups.filter((s) => view.closed.some((t) => (t.setups ?? []).includes(s.id))), [settings.setups, view.closed]);

  const write = (list: CustomStat[]) => {
    const s = useJournal.getState().settings;
    return useJournal.getState().saveSettings(withCustomStats(s, list));
  };
  const save = () => {
    if (saved.length >= CUSTOM_MAX) {
      pushToast({ kind: "error", title: `Höchstens ${CUSTOM_MAX} eigene Kennzahlen` });
      return;
    }
    const stat: CustomStat = { ...draft, id: newId("cs_"), createdAt: new Date().toISOString() };
    write([...saved, stat]).then(
      () => pushToast({ kind: "success", title: "Kennzahl gespeichert", detail: customStatTitle(stat, ctx) }),
      () => pushToast({ kind: "error", title: "Speichern fehlgeschlagen" }),
    );
  };
  // a failed write brings the dissolved tile back (new key → fresh mount)
  const [epoch, setEpoch] = useState(0);
  const remove = (id: string) => {
    write(customStatsOf(useJournal.getState().settings).filter((s) => s.id !== id)).catch(() => {
      setEpoch((e) => e + 1);
      pushToast({ kind: "error", title: "Entfernen fehlgeschlagen" });
    });
  };

  return (
    <AnaCard title={CARD_TITLES.custom} explain={explainCustom} data-testid="ana-custom" note="Kennzahl × Filter × Gruppe – gespeichert in deinen Einstellungen">
      <div className="grid gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)] lg:gap-6">
        <div className="grid content-start gap-3" data-testid="custom-builder">
          <div className="grid grid-cols-2 gap-2 pointer-coarse:gap-y-3">
            <MorphSelect<CustomMetricKey> value={metric} onChange={setMetric} options={CUSTOM_METRIC_ORDER.map((k) => ({ value: k, label: CUSTOM_METRICS[k].label }))} aria-label="Kennzahl" size="sm" className="w-full" data-testid="custom-metric" />
            <MorphSelect<CustomSince> value={since} onChange={setSince} options={(Object.keys(SINCE_LABELS) as CustomSince[]).map((k) => ({ value: k, label: SINCE_LABELS[k] }))} aria-label="Zeitraum" size="sm" className="w-full" />
            <MorphSelect<string> value={setup} onChange={setSetup} options={[{ value: NONE, label: "Alle Setups" }, ...used.map((s) => ({ value: s.id, label: s.name }))]} aria-label="Setup" size="sm" className="w-full" />
            <MorphSelect<string> value={groupBy} onChange={setGroupBy} options={[{ value: NONE, label: "Keine Gruppe" }, ...DIMENSION_ORDER.map((k) => ({ value: k, label: `nach ${DIMENSIONS[k].label}` }))]} aria-label="Gruppieren" size="sm" className="w-full" data-testid="custom-group" />
          </div>
          <Segmented<Side>
            size="sm"
            aria-label="Richtung"
            options={[
              { v: "all", label: "Alle" },
              { v: "long", label: "Long" },
              { v: "short", label: "Short" },
            ]}
            value={side}
            onChange={setSide}
            className={SEG_TOUCH}
          />
          <div className="grid gap-2 rounded-2xl border border-white/[0.08] bg-ink-800 p-3" data-testid="custom-preview">
            <span className="label">{customStatTitle(draft, ctx)}</span>
            <div className="flex flex-wrap items-baseline gap-x-3">
              <span className="dot-num text-[30px] leading-none">
                <DotFigure text={formatCustom(preview.value, m.format, cur)} />
              </span>
              <span className="num text-[11px] text-faint">
                n {preview.n}
                {preview.ci ? ` · 80 %: ${ciText(preview.ci, m.format === "pct" ? "pct" : m.format === "r" ? "R" : m.format === "money" ? "money" : "ratio", cur)}` : ""}
              </span>
            </div>
            {preview.groups && <GroupBars key={`${metric}:${groupBy}:${side}:${since}:${setup}`} res={preview} f={m.format} cur={cur} />}
            <Button variant="primary" size="sm" onClick={save} className="mt-1 justify-self-start" data-testid="custom-save">
              Speichern
            </Button>
          </div>
        </div>
        <div className="grid content-start gap-2">
          <span className="label">Gespeichert · {saved.length}</span>
          {saved.length === 0 ? (
            <EmptyState title={ANA_EMPTY.custom.title} text={ANA_EMPTY.custom.text} line={false} />
          ) : (
            <ul className="grid gap-2 sm:grid-cols-2">
              {saved.map((s, i) => (
                <StatTileView key={`${s.id}:${epoch}`} stat={s} res={results[i]!} ctx={ctx} cur={cur} onRemove={() => remove(s.id)} />
              ))}
            </ul>
          )}
        </div>
      </div>
    </AnaCard>
  );
}
