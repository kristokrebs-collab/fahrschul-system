import { useMemo } from "react";
import type { Agg } from "@/domain/agg";
import { minePatterns, PATTERNS_EMPTY_TEXT, PATTERNS_EMPTY_TITLE, PATTERNS_TITLE } from "@/domain/patterns";
import { colorClass, pct0, signed } from "@/lib/format";
import { Card } from "@/primitives/Card";
import { EmptyState } from "@/primitives/EmptyState";
import { useAccountView } from "@/store/journalStore";
import { useUi } from "@/store/uiStore";
import { Bar } from "./Bar";

/** Bundle `Dn`: label, win rate, bar, `{n} Trades · {±net}` | `keine Trades`. */
function PatternTile({ label, g }: { label: string; g: Agg }) {
  return (
    <div className="grid min-w-0 gap-1.5">
      <div className="flex justify-between gap-2 text-[13px]">
        <span className="truncate font-medium">{label}</span>
        <span className="num font-mono">{g.n ? pct0(g.winRate) : "–"}</span>
      </div>
      <Bar value={g.winRate ?? 0} />
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

/** `Muster in deinen Trades` (Bundle `The`, Plan 6.1): `md:grid-cols-2 xl:grid-cols-3` groups from `minePatterns`. */
export function PatternsCard() {
  const acc = useUi((s) => s.acc);
  const view = useAccountView(acc);
  const rows = useMemo(() => minePatterns(view.closed), [view.closed]);
  return (
    <Card title={PATTERNS_TITLE}>
      {rows.length ? (
        <div className="grid gap-x-10 md:grid-cols-2 xl:grid-cols-3">
          {rows.map((r) => (
            <div key={r.key} className="grid grid-cols-2 gap-x-5 gap-y-2.5 border-t border-line py-3.5">
              <div className="col-span-2 flex justify-between gap-2 text-xs font-semibold text-mute">
                <span>{r.title}</span>
                <span className="text-fg">{r.verdict}</span>
              </div>
              <PatternTile label={r.a.label} g={r.a.g} />
              <PatternTile label={r.b.label} g={r.b.g} />
            </div>
          ))}
        </div>
      ) : (
        <EmptyState title={PATTERNS_EMPTY_TITLE} text={PATTERNS_EMPTY_TEXT} />
      )}
    </Card>
  );
}
