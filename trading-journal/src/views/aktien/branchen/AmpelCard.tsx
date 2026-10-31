/**
 * The Ampel of the 48 industries: one tile per industry, green = the rule says "in" (Kaufsignal), red = cash. Tiles have a fixed size (the
 * grid never changes height while data loads: 48 placeholders of the same size stand in), sort and search move them with a calm spring,
 * every state is a word as well as a colour, and the stand of the data (until which day, from where, "kein Echtzeit") is the first thing
 * under the title. A source that cannot be reached is a sentence with its reason – never an empty gap.
 */
import { LayoutGroup, motion } from "motion/react";
import { useDeferredValue, useMemo, useState } from "react";
import { fmtDay, type AmpelRow } from "@/domain/industryTrend";
import { cn } from "@/lib/cn";
import { ddmmHHmm } from "@/market/format";
import { INDUSTRY_SOURCE_URL } from "@/market/industry/wire";
import { spring } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Badge } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Input } from "@/primitives/Input";
import { Segmented } from "@/primitives/Segmented";
import { Skeleton } from "@/primitives/Skeleton";
import { SEG_TOUCH } from "@/views/insights/ui";
import { CheckChip, Figure } from "../ui";
import { filterRows, sortRows } from "./ampelList";
import { useBranchen, type SortKey } from "./store";
import { BRANCHEN } from "./strings";

const T = BRANCHEN.ampel;
const pct = (w: number, d = 1): string => `${(w * 100).toLocaleString("de-DE", { minimumFractionDigits: 0, maximumFractionDigits: d })} %`;

const GRID = "grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6";
/** one size for a tile and its placeholder – the grid is as high before the data as after it */
const TILE_H = "h-[132px]";

function Tile({ row, reduced }: { row: AmpelRow; reduced: boolean }) {
  const on = row.state === "kauf";
  return (
    <motion.li
      layout={reduced ? false : "position"}
      transition={spring.layout}
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      className={cn("grid min-w-0 grid-rows-[auto_auto_auto_auto] content-start gap-1 overflow-hidden rounded-xl border p-2.5", TILE_H, on ? "border-win/30 bg-win/[0.05]" : "border-line bg-ink-950/40")}
      data-testid="branchen-tile"
      data-code={row.code}
      data-state={row.state}
    >
      <div className="flex min-w-0 items-center justify-between gap-1.5">
        <Badge tone={on ? "win" : "loss"} dot className="shrink-0 px-2 py-px text-[10.5px]">
          {on ? T.kauf : T.cash}
        </Badge>
        <span className="num text-[10.5px] text-faint">{row.code}</span>
      </div>
      <span className="line-clamp-2 min-h-[2.1rem] text-[12.5px] font-medium leading-[1.05rem] text-fg" title={row.name}>
        {row.name}
      </span>
      <p className="num min-h-[1.9rem] text-[11px] leading-[0.95rem] text-mute" data-testid="branchen-tile-since">
        {row.since === null ? T.seitBeginn : T.seit(fmtDay(row.since), row.daysSince)}
      </p>
      <p className="num text-[11px] leading-[0.95rem] text-mute" data-testid="branchen-tile-weight">
        {on ? T.gewicht(pct(row.weight)) : T.keinGewicht}
      </p>
    </motion.li>
  );
}

/**
 * The stand of the data. Before the data is there, the same cells stand with dashes: every value is one short line in a cell of fixed
 * width, so nothing below moves when the numbers arrive.
 */
function StandLine() {
  const stamp = useBranchen((s) => s.stamp);
  const dash = "–";
  const S = BRANCHEN.stand;
  const cells: [string, string, boolean][] = [
    [S.untilLabel, stamp ? fmtDay(stamp.asOf) : dash, true],
    [S.dbLabel, stamp?.database ?? dash, false],
    [S.loadedLabel, stamp ? ddmmHHmm(stamp.fetchedAt) : dash, false],
    [S.freshLabel, S.note, false],
  ];
  return (
    <div className="grid gap-1.5" data-testid="branchen-stand" data-ready={stamp ? "1" : "0"}>
      <p className="text-[12px] leading-relaxed text-mute">
        <a href={INDUSTRY_SOURCE_URL} target="_blank" rel="noopener noreferrer" className="touch-hit underline decoration-line-2 underline-offset-4 hover:text-fg hover:decoration-fg">
          {S.source}
          <span className="sr-only"> (öffnet in einem neuen Tab)</span>
        </a>
      </p>
      <dl className="num grid grid-cols-2 gap-x-4 gap-y-1.5 sm:grid-cols-[repeat(3,minmax(0,1fr))_minmax(0,1.6fr)]">
        {cells.map(([k, v, strong]) => (
          <div key={k} className="grid min-w-0 content-start gap-0.5">
            <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{k}</dt>{" "}
            <dd className={cn("min-h-[2.4em] text-[12px] leading-[1.2em]", strong ? "font-semibold text-fg" : "text-mute")}>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function AmpelCard() {
  const reduced = useReducedFx();
  const phase = useBranchen((s) => s.phase);
  const ampel = useBranchen((s) => s.ampel);
  const stale = useBranchen((s) => s.stale);
  const error = useBranchen((s) => s.error);
  const prefs = useBranchen((s) => s.prefs);
  const setPrefs = useBranchen((s) => s.setPrefs);
  const start = useBranchen((s) => s.start);
  const [query, setQuery] = useState("");
  const deferred = useDeferredValue(query);
  const busy = phase === "loading" || phase === "computing";

  const rows = useMemo(() => (ampel ? sortRows(filterRows(ampel.rows, deferred, prefs.onlyBuy), prefs.sort) : []), [ampel, deferred, prefs.onlyBuy, prefs.sort]);

  return (
    <Card
      title={T.title}
      className="h-full"
      data-testid="branchen-ampel"
      action={
        <Button size="sm" variant="ghost" onClick={() => void start({ fresh: true })} disabled={busy} data-testid="branchen-reload">
          {busy ? "Lädt …" : T.reload}
        </Button>
      }
    >
      <div className="grid min-w-0 gap-4" data-state={phase} data-testid="branchen-ampel-body">
        <p className="max-w-[80ch] text-[13px] leading-relaxed text-mute" data-testid="branchen-lead">
          {BRANCHEN.lead}
        </p>

        <section aria-label="Was die Ampel ist und was nicht" className="grid gap-2 rounded-xl border border-line-2 bg-ink-950/50 px-3.5 py-3" data-testid="branchen-honest">
          <ul className="grid gap-1.5 sm:grid-cols-2">
            {BRANCHEN.honest.map((c) => (
              <li key={c.id} className="text-[12.5px] leading-relaxed text-mute" data-point={c.id}>
                <span className="font-medium text-fg">{c.head}</span> {c.text}
              </li>
            ))}
          </ul>
          <p className="text-[12px] text-faint" data-testid="branchen-rule">
            <span className="font-medium text-mute">{BRANCHEN.baseTitle}:</span> {BRANCHEN.baseLine}
          </p>
        </section>

        {/* the state of the data, always in words */}
        <div className="grid gap-2" role="status" aria-live="polite" data-testid="branchen-status">
          <p className="min-h-5 text-[13px] leading-5 text-mute" data-testid="branchen-progress">
            {phase === "idle" || phase === "loading" ? (ampel ? "" : T.loading) : phase === "computing" ? T.computing : ""}
          </p>
          {phase === "error" && error && (
            <div className="grid gap-2 rounded-xl border border-warn/30 bg-warn/[0.06] p-3 text-[13px] leading-snug" role="alert" data-testid="branchen-error" data-reason={error.reason}>
              <p className="font-medium text-fg">Die Branchendaten konnten nicht geladen werden.</p>
              <p className="text-mute">{error.message}</p>
              <p className="text-[12px] text-faint">
                {T.noServerExtra} Es wird keine Ampel erfunden.
              </p>
              <div>
                <Button size="sm" variant="ghost" onClick={() => void start({ fresh: true })} data-testid="branchen-retry">
                  {T.retry}
                </Button>
              </div>
            </div>
          )}
          {stale && (
            <p className="text-[12.5px] leading-relaxed text-warn" data-testid="branchen-stale" data-reason={stale.reason}>
              <span className="font-medium">{T.staleHead}</span> {stale.message}
            </p>
          )}
          <StandLine />
        </div>

        <dl className="grid grid-cols-3 gap-2" data-testid="branchen-figures">
          <Figure label={T.figures.kauf} value={ampel ? `${ampel.kauf} von ${ampel.rows.length}` : "–"} testId="branchen-count-kauf" />
          <Figure label={T.figures.cash} value={ampel ? ampel.cash : "–"} testId="branchen-count-cash" />
          <Figure label={T.figures.gewicht} value={ampel ? pct(ampel.grossWeight, 0) : "–"} sub={ampel ? (ampel.capped ? T.capped : T.uncapped) : "\u00a0"} testId="branchen-gross" />
        </dl>
        <p className="text-[11.5px] leading-relaxed text-faint">{T.figureNote}</p>

        <div className="grid gap-3" data-testid="branchen-controls">
          <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
            <div className="grid min-w-0 flex-1 gap-1.5 sm:max-w-xs">
              <label htmlFor="branchen-search" className="label">
                {T.search}
              </label>
              <Input id="branchen-search" type="search" value={query} placeholder={T.searchPh} autoComplete="off" spellCheck={false} maxLength={40} onChange={(e) => setQuery(e.target.value)} data-testid="branchen-search" />
            </div>
            <div className="grid gap-1.5">
              <span className="label" id="branchen-sort-l">
                {T.sort}
              </span>
              <Segmented<SortKey> aria-labelledby="branchen-sort-l" size="sm" options={T.sorts.map((s) => ({ v: s.v, label: s.label }))} value={prefs.sort} onChange={(sort) => setPrefs({ sort })} className={SEG_TOUCH} />
            </div>
            <CheckChip checked={prefs.onlyBuy} onChange={(onlyBuy) => setPrefs({ onlyBuy })} testId="branchen-only-buy">
              {T.onlyBuy}
            </CheckChip>
          </div>
        </div>

        {ampel ? (
          rows.length ? (
            <LayoutGroup id="branchen-tiles">
              <ul className={GRID} aria-label={T.title} data-testid="branchen-grid">
                {rows.map((r) => (
                  <Tile key={r.code} row={r} reduced={reduced} />
                ))}
              </ul>
            </LayoutGroup>
          ) : (
            <p className="text-[13px] text-mute" data-testid="branchen-none">
              {T.none}
            </p>
          )
        ) : (
          <ul className={GRID} aria-hidden="true" data-testid="branchen-grid-loading">
            {Array.from({ length: 48 }, (_, i) => (
              <li key={i}>
                <Skeleton className={cn("w-full", TILE_H)} />
              </li>
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}
