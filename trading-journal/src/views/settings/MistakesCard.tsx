import { AnimatePresence, motion } from "motion/react";
import { memo, useMemo } from "react";
import type { Trade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { radius, spring, tween } from "@/motion/tokens";
import { Button } from "@/primitives/Button";
import { Card } from "@/primitives/Card";
import { Icon } from "@/primitives/icons";
import { Input } from "@/primitives/Input";
import type { MistakeRow } from "./draft";
import { ChangedDot } from "./fx";

export const MISTAKE_STRINGS = {
  title: "Fehler-Tags",
  note: "Stehen im Trade-Formular unter „Fehler“. Umbenennen oder Entfernen ändert keinen gespeicherten Trade.",
  add: "+ Fehler-Tag hinzufügen",
  tag: (n: number) => `Fehler-Tag ${n}`,
  remove: (text: string) => `Fehler-Tag entfernen${text ? `: ${text}` : ""}`,
  used: (n: number) => `${n}×`,
  usedTitle: (n: number) => `Auf ${n} Trade${n === 1 ? "" : "s"} markiert`,
  duplicate: "doppelt, wird beim Speichern zusammengefasst",
  orphansTitle: "Nur auf Trades",
  orphansNote: "Diese Tags stehen auf gespeicherten Trades, aber nicht in der Liste (z. B. umbenannt, entfernt oder aus der anderen Version). Die Trades behalten sie.",
  adopt: (tag: string) => `„${tag}“ wieder in die Liste aufnehmen`,
  empty: "Noch keine Fehler-Tags. Ohne Liste gibt es im Trade-Formular keine Fehler-Auswahl.",
} as const;

const S = MISTAKE_STRINGS;

let rowSeq = 0;
/** Draft-only row id (never stored). */
export const newMistakeRowId = (): string => `mn${Date.now().toString(36)}${(rowSeq++).toString(36)}`;

/** How many trades carry each tag (trimmed, exact match – the same rule as `normalizeTrade`). */
export function mistakeUsage(trades: readonly Pick<Trade, "mistakes">[]): Map<string, number> {
  const out = new Map<string, number>();
  for (const t of trades) {
    const seen = new Set<string>();
    for (const m of Array.isArray(t.mistakes) ? t.mistakes : []) {
      const tag = typeof m === "string" ? m.trim() : "";
      if (!tag || seen.has(tag)) continue;
      seen.add(tag);
      out.set(tag, (out.get(tag) ?? 0) + 1);
    }
  }
  return out;
}

/** Tags used on trades that the (draft) list does not contain, most used first. */
export function orphanTags(usage: ReadonlyMap<string, number>, rows: readonly MistakeRow[]): { tag: string; n: number }[] {
  const listed = new Set(rows.map((r) => r.text.trim()).filter(Boolean));
  return [...usage]
    .filter(([tag]) => !listed.has(tag))
    .map(([tag, n]) => ({ tag, n }))
    .sort((a, b) => b.n - a.n || a.tag.localeCompare(b.tag, "de"));
}

export interface MistakesCardProps {
  rows: MistakeRow[];
  onChange: (rows: MistakeRow[]) => void;
  trades: readonly Pick<Trade, "mistakes">[];
  /** The list differs from the saved settings → signal dot after the title. */
  changed?: boolean;
  className?: string;
}

/**
 * NEW `Fehler-Tags` card (`settings.mistakes`, the vocabulary of the trade form's "Fehler" chips): rename in place,
 * remove, add; each row shows on how many trades the tag is marked. Saved with the page's `Speichern` (trimmed, empty
 * rows dropped, duplicates merged). Data safety: stored trades are NEVER rewritten – a renamed or removed tag stays on
 * its trades and is listed under `Nur auf Trades` with a one-tap `wieder aufnehmen` (also tags that came with the
 * other version's trades). Rows enter / leave like the Grundregeln rows (`popLayout`, transform/opacity only).
 */
export const MistakesCard = memo(function MistakesCard({ rows, onChange, trades, changed = false, className }: MistakesCardProps) {
  const usage = useMemo(() => mistakeUsage(trades), [trades]);
  const orphans = useMemo(() => orphanTags(usage, rows), [usage, rows]);
  const ids = rows.map((r) => r.id).join();
  const counts = new Map<string, number>();
  for (const r of rows) {
    const t = r.text.trim();
    if (t) counts.set(t, (counts.get(t) ?? 0) + 1);
  }

  return (
    <Card
      title={
        <>
          {S.title}
          <ChangedDot show={changed} />
        </>
      }
      note={S.note}
      className={className}
      data-testid="settings-mistakes-card"
    >
      {rows.length === 0 && <p className="mb-3 rounded-xl border border-dashed border-line-2 p-3 text-[12.5px] text-mute">{S.empty}</p>}
      <motion.ul layout layoutDependency={ids} transition={{ layout: spring.layout }} className="grid gap-2" aria-label={S.title}>
        <AnimatePresence mode="popLayout" initial={false}>
          {rows.map((row, i) => {
            const tag = row.text.trim();
            const n = tag ? (usage.get(tag) ?? 0) : 0;
            const dup = !!tag && (counts.get(tag) ?? 0) > 1 && rows.findIndex((r) => r.text.trim() === tag) !== i;
            return (
              <motion.li
                key={row.id}
                layout
                layoutDependency={ids}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.98, transition: tween.exit }}
                transition={{ ...spring.layout, layout: spring.layout }}
                style={{ borderRadius: radius.input }}
                className="grid gap-1"
                data-testid={`mistake-row-${i}`}
              >
                <div className="flex items-center gap-2">
                  <Input
                    value={row.text}
                    aria-label={S.tag(i + 1)}
                    onChange={(e) => onChange(rows.map((r) => (r.id === row.id ? { ...r, text: e.target.value } : r)))}
                    autoComplete="off"
                    invalid={dup}
                    wrapperClassName="min-w-0 flex-1"
                  />
                  <span className={cn("num w-10 shrink-0 text-right font-mono text-[11.5px]", n ? "text-mute" : "text-faint/60")} title={S.usedTitle(n)}>
                    <span aria-hidden="true">{S.used(n)}</span>
                    <span className="sr-only">{S.usedTitle(n)}</span>
                  </span>
                  <motion.button
                    type="button"
                    aria-label={S.remove(tag)}
                    onClick={() => onChange(rows.filter((r) => r.id !== row.id))}
                    whileTap={{ scale: 0.92 }}
                    transition={spring.press}
                    className="grid size-10 shrink-0 place-items-center rounded-xl border border-line-2 text-mute transition-colors hover:border-loss/40 hover:text-loss pointer-coarse:size-11 [&>svg]:size-4"
                  >
                    <Icon name="x" />
                  </motion.button>
                </div>
                {dup && <span className="pl-1 text-[11px] text-warn">{S.duplicate}</span>}
              </motion.li>
            );
          })}
        </AnimatePresence>
      </motion.ul>
      <Button size="sm" className="mt-3 justify-self-start" onClick={() => onChange([...rows, { id: newMistakeRowId(), text: "" }])}>
        {S.add}
      </Button>

      {orphans.length > 0 && (
        <div className="mt-5 grid gap-2 border-t border-line pt-4" data-testid="mistake-orphans">
          <span className="label !text-[9.5px]">{S.orphansTitle}</span>
          <p className="text-[11.5px] text-faint">{S.orphansNote}</p>
          <ul className="flex flex-wrap gap-2" aria-label={S.orphansTitle}>
            {orphans.map((o) => (
              <li key={o.tag}>
                <button
                  type="button"
                  onClick={() => onChange([...rows, { id: newMistakeRowId(), text: o.tag }])}
                  aria-label={S.adopt(o.tag)}
                  className="touch-hit inline-flex max-w-full items-center gap-2 rounded-full border border-line-2 bg-white/[0.03] px-3 py-1.5 text-left text-[12px] text-fg/90 transition-colors hover:border-white/30"
                >
                  <span className="min-w-0 [overflow-wrap:anywhere]">{o.tag}</span>
                  <span className="num shrink-0 font-mono text-[11px] text-mute">{S.used(o.n)}</span>
                  <span aria-hidden="true" className="shrink-0 text-mute">
                    +
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
    </Card>
  );
});
