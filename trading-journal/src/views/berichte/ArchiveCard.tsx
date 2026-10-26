/**
 * Report archive (P04): every finished period of the chosen kind with closed trades – derived from the journal, so it is
 * complete on every device and after an import. Recent unopened reports carry "neu" (seen markers in
 * `settings.coach.reports.seen`, `NEW_DAYS`); the shown one is marked. Eight rows, then "Alle anzeigen".
 */
import { useState } from "react";
import { KIND_REPORT, type ArchiveEntry, type ReportKind } from "@/domain/reports";
import { cn } from "@/lib/cn";
import { textLink } from "@/lib/textLink";
import { pct0, signed } from "@/lib/format";
import { Badge } from "@/primitives/Badge";
import { Card } from "@/primitives/Card";
import { useBerichteUi } from "./berichteStore";

const SHOW = 8;
/** "neu" only for unopened reports that ended recently – a long history is not a pile of news. */
export const NEW_DAYS: Readonly<Record<ReportKind, number>> = { day: 2, week: 14, month: 45, quarter: 100, year: 370 };

/** The archive entry counts as new (unopened and recent). */
export const isNew = (a: ArchiveEntry, now: number): boolean => !a.seen && now - a.period.to <= NEW_DAYS[a.period.kind] * 86_400_000;

export function ArchiveCard({ archive, kind, current, cur, now, className }: { archive: readonly ArchiveEntry[]; kind: ReportKind; current: string; cur: string; now: number; className?: string }) {
  const setPeriod = useBerichteUi((s) => s.setPeriod);
  const [all, setAll] = useState(false);
  const rows = all ? archive : archive.slice(0, SHOW);
  const fresh = archive.filter((a) => isNew(a, now)).length;
  return (
    <Card title="Archiv" note={archive.length ? `${archive.length} ${KIND_REPORT[kind]}${archive.length === 1 ? "" : "e"}${fresh ? ` · ${fresh} neu` : ""}` : undefined} className={className} data-testid="report-archive">
      {archive.length === 0 ? (
        <p className="text-[12.5px] leading-relaxed text-mute">Noch kein abgeschlossener Zeitraum mit Trades. Berichte entstehen automatisch, sobald ein Zeitraum vorbei ist.</p>
      ) : (
        <ul className="grid" aria-label={`Archiv · ${KIND_REPORT[kind]}e`}>
          {rows.map((a) => {
            const active = a.period.key === current;
            return (
              <li key={a.period.key} className="border-b border-line/60 last:border-b-0">
                <button
                  type="button"
                  onClick={() => setPeriod(a.period.key)}
                  aria-current={active ? "true" : undefined}
                  data-testid="report-archive-row"
                  data-key={a.period.key}
                  className={cn("grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-white/[0.04]", active && "bg-white/[0.06]")}
                >
                  <span className="grid min-w-0 gap-0.5">
                    <span className="flex min-w-0 items-center gap-2">
                      <span className={cn("truncate text-[13px]", active ? "font-semibold text-fg" : "text-fg")}>{a.period.label}</span>
                      {isNew(a, now) && (
                        <Badge tone="warn" dot>
                          neu
                        </Badge>
                      )}
                    </span>
                    <span className="num font-mono text-[10.5px] text-faint">
                      {a.n} Trade{a.n === 1 ? "" : "s"} · {pct0(a.winRate)}
                    </span>
                  </span>
                  <span className={cn("num font-mono text-[12.5px]", a.net > 0 ? "text-win" : a.net < 0 ? "text-loss" : "text-mute")}>
                    {signed(a.net, 0)} {cur}
                  </span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {archive.length > SHOW && (
        <button type="button" onClick={() => setAll((v) => !v)} className={cn(textLink, "mt-2 justify-self-start text-[12px] pointer-coarse:min-h-11")} aria-expanded={all}>
          {all ? "Weniger anzeigen" : `Alle anzeigen (${archive.length})`}
        </button>
      )}
    </Card>
  );
}
