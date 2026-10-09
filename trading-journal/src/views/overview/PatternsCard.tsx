import { useMemo, useRef } from "react";
import type { Agg } from "@/domain/agg";
import { minePatterns, PATTERNS_EMPTY_TEXT, PATTERNS_EMPTY_TITLE, PATTERNS_TITLE } from "@/domain/patterns";
import { colorClass, pct0, signed } from "@/lib/format";
import { RevealGroup, RevealItem } from "@/motion/Reveal";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { useAccountView } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { Bar, BarPercent, useBarFill } from "./Bar";

/** Bundle `Dn`: label, win rate (counts up with its bar on first view), bar, `{n} Trades · {±net}` | `keine Trades`. */
function PatternTile({ label, g, index }: { label: string; g: Agg; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const known = g.n > 0 && g.winRate != null;
  const fill = useBarFill(ref, known ? g.winRate : 0, index);
  return (
    <div ref={ref} className="grid min-w-0 gap-1.5">
      <div className="flex justify-between gap-2 text-[13px]">
        <span className="truncate font-medium">{label}</span>
        <span className="num font-mono">{known ? <BarPercent fill={fill} label={pct0(g.winRate)} /> : "–"}</span>
      </div>
      <Bar source={fill} />
      <div className="num text-[11px] text-faint">
        {g.n ? (
          <>
            {g.n} Trades · <span className={colorClass(g.net)}>{signed(g.net, 0)}</span>
          </>
        ) : (
          "keine Trades"
        )}
      </div>
    </div>
  );
}

/**
 * `Muster in deinen Trades` (Bundle `The`, Plan 6.1): `md:grid-cols-2 xl:grid-cols-3` groups from `minePatterns`.
 * Groups blur-fade in one after another on first view; inside each, the two win rates count up with their bars.
 */
export function PatternsCard() {
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const rows = useMemo(() => minePatterns(view.closed), [view.closed]);
  return (
    <Card title={PATTERNS_TITLE}>
      {rows.length ? (
        <RevealGroup className="grid gap-x-10 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r, i) => (
            <RevealItem key={r.key} className="grid grid-cols-2 gap-x-5 gap-y-2.5 border-t border-line py-3.5">
              <div className="col-span-2 flex justify-between gap-2 text-xs font-semibold text-mute">
                <span>{r.title}</span>
                <span className="text-fg">{r.verdict}</span>
              </div>
              <PatternTile label={r.a.label} g={r.a.g} index={2 * i} />
              <PatternTile label={r.b.label} g={r.b.g} index={2 * i + 1} />
            </RevealItem>
          ))}
        </RevealGroup>
      ) : (
        <EmptyState title={PATTERNS_EMPTY_TITLE} text={PATTERNS_EMPTY_TEXT} />
      )}
    </Card>
  );
}
