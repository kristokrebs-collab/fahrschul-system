/**
 * "Meine Strategien": several drafts side by side. A row opens the strategy in the editor; the tick puts it into the next
 * "Alle testen". The strategy being edited is marked; each row says how many versions and paper accounts it has.
 */
import { motion } from "motion/react";
import { MAX_STRATEGIES, type StoredStrategy } from "@/domain/strategytext";
import { cn } from "@/lib/cn";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { GlyphCheck } from "@/primitives/icons";
import { useStudio } from "./studioStore";
import { STUDIO } from "./strings";

const L = STUDIO.list;

function Row({ s, open, picked }: { s: StoredStrategy; open: boolean; picked: boolean }) {
  const top = s.versions[s.versions.length - 1];
  return (
    <li className={cn("flex items-stretch gap-1 rounded-xl border transition-colors", open ? "border-white/30 bg-white/[0.05]" : "border-line bg-ink-950/40 hover:border-line-2")} data-testid={`studio-item-${s.id}`} data-open={open || undefined}>
      <button
        type="button"
        role="checkbox"
        aria-checked={picked}
        aria-label={L.pick(s.name)}
        onClick={() => useStudio.getState().toggleSelect(s.id)}
        className="grid min-h-11 w-11 shrink-0 place-items-center rounded-l-xl text-fg"
        data-testid={`studio-pick-${s.id}`}
      >
        <span aria-hidden="true" className={cn("grid size-[18px] place-items-center rounded-md border transition-colors", picked ? "border-transparent bg-fg text-ink-950" : "border-line-2 bg-transparent")}>
          {picked && <GlyphCheck className="size-3" />}
        </span>
      </button>
      <button type="button" onClick={() => void useStudio.getState().open(s.id)} aria-label={L.open(s.name)} aria-current={open || undefined} className="grid min-w-0 flex-1 content-center gap-0.5 rounded-r-xl py-2 pr-3 text-left" data-testid={`studio-open-${s.id}`}>
        <span className="truncate text-[13px] font-medium text-fg">{s.name}</span>
        <span className="truncate text-[11.5px] text-faint">
          {top ? `v${top.n} · ${L.versions(s.versions.length)}` : L.draftOnly}
          {s.live.length > 0 && ` · ${L.live(s.live.length)}`}
        </span>
      </button>
    </li>
  );
}

export function StrategyList({ strategies, className }: { strategies: StoredStrategy[]; className?: string }) {
  const openId = useStudio((s) => s.editor.id);
  const selected = useStudio((s) => s.selected);
  const busy = useStudio((s) => s.cmp.status === "loading" || s.cmp.status === "running");
  const full = strategies.length >= MAX_STRATEGIES;
  const picked = strategies.filter((s) => selected.includes(s.id)).length;
  const hint = picked === 0 ? (strategies.length > 1 ? STUDIO.compare.pickNone : null) : picked === 1 ? STUDIO.compare.pickOne : null;
  return (
    <Card title={L.title} note={L.note} className={className} data-testid="studio-list">
      <div className="grid gap-3">
        {strategies.length === 0 ? (
          <p className="rounded-xl border border-dashed border-line-2 px-3 py-4 text-[12.5px] text-mute" data-testid="studio-list-empty">
            {L.empty}
          </p>
        ) : (
          <ul className="grid gap-1.5" aria-label={L.title}>
            {strategies.map((s) => (
              <Row key={s.id} s={s} open={s.id === openId} picked={selected.includes(s.id)} />
            ))}
          </ul>
        )}
        {strategies.length > 1 && (
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => useStudio.getState().setSelected(picked === strategies.length ? [] : strategies.map((s) => s.id))}>
              {picked === strategies.length ? L.selectNone : L.selectAll}
            </Button>
          </div>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => void useStudio.getState().newDraft()} disabled={full} data-testid="studio-new">
            {L.newBtn}
          </Button>
          {busy ? (
            <Button variant="danger" onClick={() => useStudio.getState().cancelCompare()} data-testid="studio-compare-cancel">
              {STUDIO.backtest.cancel}
            </Button>
          ) : (
            <Button variant="primary" onClick={() => void useStudio.getState().runCompare()} disabled={picked < 2} data-testid="studio-compare-run">
              {STUDIO.compare.run}
            </Button>
          )}
          <motion.span key={picked} initial={{ opacity: 0.4 }} animate={{ opacity: 1 }} className="text-[12px] text-mute" data-testid="studio-picked">
            {STUDIO.compare.count(picked)}
          </motion.span>
        </div>
        {full && <p className="text-[12px] text-warn">{L.full(MAX_STRATEGIES)}</p>}
        {hint && (
          <p className="text-[12px] text-faint" data-testid="studio-pick-hint">
            {hint}
          </p>
        )}
      </div>
    </Card>
  );
}
