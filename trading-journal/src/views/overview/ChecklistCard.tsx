import { useId, useMemo, useRef, useState } from "react";
import type { Agg } from "@/domain/agg";
import { type ChecklistItemStats, CHECKLIST_CARD_TITLE, CHECKLIST_EMPTY_TEXT, CHECKLIST_EMPTY_TITLE, CHECKLIST_MISSED_EMPTY, CHECKLIST_MISSED_TITLE, CHECKLIST_TILE_FULL, CHECKLIST_TILE_GAPS, evaluateChecklist, explainChecklist, missedLabel } from "@/domain/checklist";
import { cn } from "@/lib/cn";
import { colorClass, pct0, signed } from "@/lib/format";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse, Expander } from "@/primitives/Expander";
import { useAccountView } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { Bar, BarPercent, useBarFill } from "./Bar";
import { ExplanationView } from "./explainer";

/**
 * One `Alles erfüllt` / `Lücken` tile: the percent counts up frame-synced with its bar on first view. The tile is a
 * button that opens the checklist evaluation (a tile-looking block that did nothing on tap, tablet audit 2a.7).
 */
function Tile({ label, g, tone, index, open, controls, onOpen }: { label: string; g: Agg; tone: "win" | "loss"; index: number; open: boolean; controls: string; onOpen: () => void }) {
  const ref = useRef<HTMLDivElement>(null);
  const fill = useBarFill(ref, g.winRate, index);
  return (
    <RevealItem ref={ref} className="relative rounded-xl border border-line bg-ink-950/50 p-3 transition-colors hover:border-white/20">
      {/* the whole tile is the hit area; the button's box covers it (its label is the tile text) and stacks above the
          tile's content – the bar fill (a scaleX layer) and the count-up figure would otherwise take part of the taps */}
      <button type="button" onClick={onOpen} aria-expanded={open} aria-controls={controls} className="absolute inset-0 z-10 rounded-[inherit]" aria-label={`${label}: Auswertung zeigen`} />
      <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{label}</div>
      <div className={cn("num mt-1 font-mono text-2xl font-medium", g.n ? (tone === "win" ? "text-win" : "text-loss") : "text-faint")}>
        {g.winRate == null ? pct0(g.winRate) : <BarPercent fill={fill} label={pct0(g.winRate)} />}
      </div>
      <Bar source={fill} className="mt-1.5" fill={tone === "win" ? "bg-win" : "bg-loss"} />
      <div className="num mt-1 text-[11.5px] text-mute">
        {g.n} Trades · <span className={colorClass(g.net)}>{signed(g.net, 0)}</span>
      </div>
    </RevealItem>
  );
}

export const CHECKLIST_IMPACT_TITLE = "Wirkung je Punkt";
export const CHECKLIST_IMPACT_NOTE = "Win-Rate mit ✓ · ohne";

/** Items with trades on both sides (checked / left open), strongest win-rate difference first. */
export function impactRows(items: readonly ChecklistItemStats[]): ChecklistItemStats[] {
  return items.filter((i) => i.delta != null).sort((a, b) => Math.abs(b.delta ?? 0) - Math.abs(a.delta ?? 0) || b.n - a.n);
}

/** `+47 pp` / `−20 pp` (rounded percentage points). */
const ppText = (d: number): string => {
  const v = Math.round(d * 100);
  return `${v > 0 ? "+" : v < 0 ? "−" : "±"}${Math.abs(v)} pp`;
};

/**
 * `Wirkung je Punkt` (design pass v3): per checklist item the win rate with the item ticked vs left open, strongest
 * difference first. It only takes the card's FREE height when its grid row is taller than the card's own content (a
 * stretched card next to the ranking): the list has no height of its own (`basis-0`) and rows that do not fit wrap
 * into a second, clipped flex column – whole rows, never a cut one; no free height (phones, a short row) → none shown.
 * The heading travels with the first row.
 */
function ImpactList({ rows }: { rows: readonly ChecklistItemStats[] }) {
  if (!rows.length) return null;
  return (
    <div className="flex min-h-0 flex-1 basis-0 flex-col flex-wrap content-start gap-x-8 overflow-hidden" data-testid="checklist-impact">
      {/* a flex line always keeps its first item: a zero-height first item lets even the first row wrap away whole */}
      <span aria-hidden="true" className="h-0 w-full shrink-0" />
      {rows.map((r, i) => (
        <div key={r.text} className="w-full shrink-0">
          {i === 0 && (
            <div className="mb-2 mt-1 flex items-baseline justify-between gap-3">
              <span className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{CHECKLIST_IMPACT_TITLE}</span>
              <span className="text-[11px] text-faint">{CHECKLIST_IMPACT_NOTE}</span>
            </div>
          )}
          <div className="grid grid-cols-[minmax(0,1fr)_auto_3.75rem] items-center gap-x-3 border-t border-line py-2 text-[12.5px]">
            <span className="line-clamp-2 min-w-0 text-fg">{r.text}</span>
            <span className="num shrink-0 font-mono text-xs text-mute">
              {pct0(r.withChecked.winRate)} · {pct0(r.withoutChecked.winRate)}
            </span>
            <span className={cn("num text-right font-mono text-xs", (r.delta ?? 0) > 0 ? "text-win" : (r.delta ?? 0) < 0 ? "text-loss" : "text-mute")}>{ppText(r.delta ?? 0)}</span>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * `Checkliste` (Bundle `khe`, Plan 6.1): `Alles erfüllt` / `Lücken` tiles (blur-fade cascade, percent + bar fill on
 * first view), `Am häufigsten ausgelassen` rows slide in after them, expander → `Checklisten-Auswertung`.
 */
export function ChecklistCard() {
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const ev = useMemo(() => evaluateChecklist(view.closed), [view.closed]);
  const impact = useMemo(() => impactRows(ev.items), [ev.items]);
  const [open, setOpen] = useState(false);
  const regionId = useId();
  const tiles = [
    [CHECKLIST_TILE_FULL, ev.full, "win"],
    [CHECKLIST_TILE_GAPS, ev.gaps, "loss"],
  ] as const;

  return (
    <Card title={CHECKLIST_CARD_TITLE} action={<Expander open={open} onToggle={() => setOpen((o) => !o)} label="Checkliste" controls={regionId} />}>
      <Collapse open={open} id={regionId} className="mb-4">
        <ExplanationView d={explainChecklist(ev)} className="!mt-0" />
      </Collapse>
      {ev.withList.length ? (
        <RevealGroup className="flex min-h-0 flex-1 flex-col gap-4">
          <div className="grid grid-cols-2 gap-3">
            {tiles.map(([label, g, tone], i) => (
              <Tile key={label} label={label} g={g} tone={tone} index={i} open={open} controls={regionId} onOpen={() => setOpen(true)} />
            ))}
          </div>
          <div>
            <RevealItem className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{CHECKLIST_MISSED_TITLE}</RevealItem>
            {ev.missed.length ? (
              ev.missed.map((m) => (
                <RevealItem key={m.text} className="flex items-center justify-between gap-3 border-t border-line py-2 text-[12.5px]">
                  {/* two lines instead of an ellipsis: "Hebel im Rahmen (Scalp 4x, Makro …" hid the rule (tablet audit 3.4) */}
                  <span className="line-clamp-2 min-w-0 text-fg">{m.text}</span>
                  <span className="num shrink-0 font-mono text-xs text-mute">{missedLabel(m)}</span>
                </RevealItem>
              ))
            ) : (
              <RevealItem as="div" className="text-[12.5px] text-win">
                {CHECKLIST_MISSED_EMPTY}
              </RevealItem>
            )}
          </div>
          <ImpactList rows={impact} />
        </RevealGroup>
      ) : (
        <EmptyState title={CHECKLIST_EMPTY_TITLE} text={CHECKLIST_EMPTY_TEXT} />
      )}
    </Card>
  );
}
