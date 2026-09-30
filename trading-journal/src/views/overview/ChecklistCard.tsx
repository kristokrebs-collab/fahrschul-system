import { useId, useMemo, useState } from "react";
import { CHECKLIST_CARD_TITLE, CHECKLIST_EMPTY_TEXT, CHECKLIST_EMPTY_TITLE, CHECKLIST_MISSED_EMPTY, CHECKLIST_MISSED_TITLE, CHECKLIST_TILE_FULL, CHECKLIST_TILE_GAPS, evaluateChecklist, explainChecklist, missedLabel } from "@/domain/checklist";
import { cn } from "@/lib/cn";
import { colorClass, pct0, signed } from "@/lib/format";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { Collapse, Expander } from "@/primitives/Expander";
import { useAccountView } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { Bar } from "./Bar";
import { ExplanationView } from "./explainer";

/** `Checkliste` (Bundle `khe`, Plan 6.1): `Alles erfüllt` / `Lücken` tiles, `Am häufigsten ausgelassen`, expander → `Checklisten-Auswertung`. */
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
        <div className="grid grid-cols-1 gap-4">
          <div className="grid grid-cols-2 gap-3">
            {tiles.map(([label, g, tone]) => (
              <div key={label} className="rounded-xl border border-line bg-ink-950/50 p-3">
                <div className="text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{label}</div>
                <div className={cn("num mt-1 font-mono text-2xl font-medium", g.n ? (tone === "win" ? "text-win" : "text-loss") : "text-faint")}>{pct0(g.winRate)}</div>
                <Bar value={g.winRate ?? 0} className="mt-1.5" fill={tone === "win" ? "bg-win" : "bg-loss"} />
                <div className="num mt-1 text-[11.5px] text-mute">
                  {g.n} Trades · <span className={colorClass(g.net)}>{signed(g.net, 0)}</span>
                </div>
              </div>
            ))}
          </div>
          <div>
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.1em] text-mute">{CHECKLIST_MISSED_TITLE}</div>
            {ev.missed.length ? (
              ev.missed.map((m) => (
                <div key={m.text} className="flex items-center justify-between gap-3 border-t border-line py-2 text-[12.5px]">
                  <span className="min-w-0 truncate text-fg">{m.text}</span>
                  <span className="num shrink-0 font-mono text-xs text-mute">{missedLabel(m)}</span>
                </div>
              ))
            ) : (
              <p className="text-[12.5px] text-win">{CHECKLIST_MISSED_EMPTY}</p>
            )}
          </div>
        </div>
      ) : (
        <EmptyState title={CHECKLIST_EMPTY_TITLE} text={CHECKLIST_EMPTY_TEXT} />
      )}
    </Card>
  );
}
