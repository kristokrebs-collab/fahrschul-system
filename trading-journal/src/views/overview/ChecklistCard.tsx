import { useId, useMemo, useRef, useState } from "react";
import type { Agg } from "@/domain/agg";
import { CHECKLIST_CARD_TITLE, CHECKLIST_EMPTY_TEXT, CHECKLIST_EMPTY_TITLE, CHECKLIST_MISSED_EMPTY, CHECKLIST_MISSED_TITLE, CHECKLIST_TILE_FULL, CHECKLIST_TILE_GAPS, evaluateChecklist, explainChecklist, missedLabel } from "@/domain/checklist";
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
      {/* the whole tile is the hit area; the button's box covers it (its label is the tile text) */}
      <button type="button" onClick={onOpen} aria-expanded={open} aria-controls={controls} className="absolute inset-0 rounded-[inherit]" aria-label={`${label}: Auswertung zeigen`} />
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

/**
 * `Checkliste` (Bundle `khe`, Plan 6.1): `Alles erfüllt` / `Lücken` tiles (blur-fade cascade, percent + bar fill on
 * first view), `Am häufigsten ausgelassen` rows slide in after them, expander → `Checklisten-Auswertung`.
 */
export function ChecklistCard() {
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const ev = useMemo(() => evaluateChecklist(view.closed), [view.closed]);
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
        <RevealGroup className="grid grid-cols-1 gap-4">
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
        </RevealGroup>
      ) : (
        <EmptyState title={CHECKLIST_EMPTY_TITLE} text={CHECKLIST_EMPTY_TEXT} />
      )}
    </Card>
  );
}
