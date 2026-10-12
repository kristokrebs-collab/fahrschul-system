/**
 * Comparison sheet of 2–3 Entscheidungsgrundlagen (P07): pick the setups (chips, at most 3; preset = the two with the
 * most trades), the columns are dealt as cards (`CardSpread`), every key number with its 80 % interval (P03 statistics:
 * Wilson, t) and a confidence whisker on a shared axis, conformity and exit fidelity; below, the differences against the
 * leader with their verdict ("klar" / "Tendenz" / "offen" / "zu wenig"). "Trade the best": the leader is the setup with
 * the highest lower bound of Ø R, its name gets the signal marker.
 */
import { useMemo, useState } from "react";
import { compareStrategies, type StrategyRow } from "@/domain/strategy";
import type { EnrichedTrade, Settings } from "@/domain/types";
import { cn } from "@/lib/cn";
import { n0, pct0, r as fmtR } from "@/lib/format";
import { CardSpread } from "@/motion/pulse/CardSpread";
import { TactileHighlight } from "@/motion/pulse/TactileHighlight";
import { Sheet } from "@/motion/Sheet";
import { StaggerItem } from "@/motion/Stagger";
import { Badge } from "@/primitives/Badge";
import { CiWhisker, ciText, SigBadge, whiskerDomain } from "@/views/analyse/ui";

export const COMPARE_STRINGS = {
  title: "Grundlagen vergleichen",
  pick: "Bis zu drei Grundlagen wählen",
  needTwo: "Wähle mindestens zwei Grundlagen.",
  leader: "Führt",
  thin: "zu wenig",
  diffs: (name: string) => `Unterschied zu ${name}`,
} as const;

export const COMPARE_MAX = 3;

export function CompareSheet({ open, onClose, setups, closed, settings }: { open: boolean; onClose: () => void; setups: Settings["setups"]; closed: readonly EnrichedTrade[]; settings: Pick<Settings, "capital" | "currency"> }) {
  const counts = useMemo(() => new Map(setups.map((s) => [s.id, closed.filter((t) => (t.setups || []).includes(s.id)).length])), [setups, closed]);
  const preset = useMemo(
    () =>
      [...setups]
        .sort((a, b) => (counts.get(b.id) ?? 0) - (counts.get(a.id) ?? 0))
        .slice(0, 2)
        .map((s) => s.id),
    [setups, counts],
  );
  const [picked, setPicked] = useState<string[] | null>(null);
  const ids = picked ?? preset;
  const chosen = setups.filter((s) => ids.includes(s.id));
  const cmp = useMemo(() => (chosen.length >= 2 ? compareStrategies(chosen, closed, settings) : null), [chosen, closed, settings]);
  const toggle = (id: string) => setPicked((p) => {
    const cur = p ?? preset;
    if (cur.includes(id)) return cur.filter((x) => x !== id);
    return cur.length >= COMPARE_MAX ? [...cur.slice(1), id] : [...cur, id];
  });
  const rDomain = useMemo(() => (cmp ? whiskerDomain(cmp.rows.map((r) => r.rCI), cmp.rows.map((r) => r.avgR)) : ([-1, 1] as [number, number])), [cmp]);
  const wrDomain: [number, number] = [0, 1];
  const playKey = ids.join("|").length + ids.length * 31;
  const leader = cmp?.rows.find((r) => r.best) ?? null;

  return (
    <Sheet open={open} onClose={onClose} title={COMPARE_STRINGS.title} size="lg">
      <div className="grid gap-5" data-testid="setup-compare">
        <StaggerItem className="grid gap-2">
          <span className="text-[11px] text-faint">{COMPARE_STRINGS.pick}</span>
          <div className="flex flex-wrap gap-1.5" role="group" aria-label={COMPARE_STRINGS.pick}>
            {setups.map((s) => {
              const on = ids.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggle(s.id)}
                  className={cn("inline-flex min-h-9 items-center gap-2 rounded-full border px-3 text-[12px] transition-colors duration-200 pointer-coarse:min-h-11", on ? "border-white/40 bg-white/[0.06] text-fg" : "border-line-2 text-mute hover:border-white/25 hover:text-fg")}
                >
                  <span className="size-2 rounded-full" style={{ background: s.color }} aria-hidden="true" />
                  {s.name}
                  <span className="num font-mono text-[10.5px] text-faint">{counts.get(s.id) ?? 0}</span>
                </button>
              );
            })}
          </div>
        </StaggerItem>

        {!cmp ? (
          <p className="text-[13px] text-mute">{COMPARE_STRINGS.needTwo}</p>
        ) : (
          <>
            <StaggerItem>
              <p className="text-[14px] font-medium leading-snug" data-testid="setup-compare-verdict">
                {leader ? (
                  <>
                    <TactileHighlight key={leader.id} tone="signal" playOnView tab={false}>
                      {leader.name}
                    </TactileHighlight>{" "}
                    <span className="text-mute">{cmp.verdict.slice(leader.name.length).trim()}</span>
                  </>
                ) : (
                  <span className="text-mute">{cmp.verdict}</span>
                )}
              </p>
            </StaggerItem>
            <CardSpread variant="deal" play={playKey} label={COMPARE_STRINGS.title} className={cn("grid gap-3", cmp.rows.length === 3 ? "sm:grid-cols-3" : "sm:grid-cols-2")}>
              {cmp.rows.map((r, i) => (
                <Column key={r.id} row={r} index={i} rDomain={rDomain} wrDomain={wrDomain} cur={settings.currency} />
              ))}
            </CardSpread>
            {cmp.pairs.map((p) => (
              <StaggerItem key={`${p.a.label}-${p.b.label}`} className="grid gap-2">
                <span className="label !text-fg">
                  {p.b.label} · {COMPARE_STRINGS.diffs(p.a.label)}
                </span>
                <ul className="grid gap-1.5">
                  {p.rows
                    .filter((r) => r.key !== "n")
                    .map((r) => (
                      <li key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 border-t border-line pt-1.5 text-[12.5px]">
                        <span className="text-mute">{r.label}</span>
                        <span className="num font-mono text-fg/90">{deltaText(r.key, r.delta ? -r.delta : r.delta, settings.currency)}</span>
                        <SigBadge verdict={r.verdict} />
                      </li>
                    ))}
                </ul>
              </StaggerItem>
            ))}
          </>
        )}
      </div>
    </Sheet>
  );
}

function deltaText(key: string, d: number | null, cur: string): string {
  if (d == null || !Number.isFinite(d)) return "–";
  const sign = d > 0 ? "+" : d < 0 ? "−" : "±";
  const a = Math.abs(d);
  if (key === "winRate") return `${sign}${Math.round(a * 100)} pp`;
  if (key === "avgR") return `${sign}${a.toFixed(2).replace(".", ",")} R`;
  if (key === "pf") return `${sign}${a.toFixed(2).replace(".", ",")}`;
  return `${sign}${n0(a)} ${cur}`;
}

function Column({ row, index, rDomain, wrDomain, cur }: { row: StrategyRow; index: number; rDomain: [number, number]; wrDomain: [number, number]; cur: string }) {
  return (
    <article className={cn("grid h-full content-start gap-3 rounded-2xl border p-3.5", row.best ? "border-white/40 bg-white/[0.04]" : "border-line bg-ink-950/50")} aria-label={row.name} data-testid="setup-compare-column">
      <div className="flex items-start justify-between gap-2">
        <span className="flex min-w-0 items-center gap-2 text-[14px] font-semibold">
          <span className="size-2.5 shrink-0 rounded-full" style={{ background: row.color }} aria-hidden="true" />
          <span className="[overflow-wrap:anywhere]">{row.name}</span>
        </span>
        {row.best ? (
          <Badge tone="win" dot>
            {COMPARE_STRINGS.leader}
          </Badge>
        ) : row.thin ? (
          <Badge tone="mute">{COMPARE_STRINGS.thin}</Badge>
        ) : null}
      </div>
      <Metric label="Trades">{row.n}</Metric>
      <Metric label="Win-Rate" sub={row.wrCI ? `80 %: ${ciText(row.wrCI, "pct")}` : undefined}>
        {pct0(row.winRate)}
        <CiWhisker ci={row.wrCI} value={row.winRate} domain={wrDomain} index={index} tone="fg" className="mt-1" />
      </Metric>
      <Metric label="Ø R" sub={row.rCI ? `80 %: ${ciText(row.rCI, "R")}` : undefined} tone={(row.avgR ?? 0) > 0 ? "text-win" : (row.avgR ?? 0) < 0 ? "text-loss" : undefined}>
        {fmtR(row.avgR)}
        <CiWhisker ci={row.rCI} value={row.avgR} domain={rDomain} index={index + 1} className="mt-1" />
      </Metric>
      <Metric label="Erwartung" sub={row.expCI ? `80 %: ${ciText(row.expCI, "money", cur)}` : undefined}>
        {row.exp == null ? "–" : `${row.exp > 0 ? "+" : row.exp < 0 ? "−" : ""}${n0(Math.abs(row.exp))} ${cur}`}
      </Metric>
      <div className="grid grid-cols-2 gap-2">
        <Metric label="Profit-Faktor">{row.pf == null ? "–" : row.pf === Infinity ? "∞" : row.pf.toFixed(2).replace(".", ",")}</Metric>
        <Metric label="Netto" tone={row.net > 0 ? "text-win" : row.net < 0 ? "text-loss" : undefined}>
          {`${row.net > 0 ? "+" : row.net < 0 ? "−" : ""}${n0(Math.abs(row.net))}`}
        </Metric>
        <Metric label="Konformität">{row.conformity ?? "–"}</Metric>
        <Metric label="Exit-Treue">{pct0(row.exitFidelity)}</Metric>
      </div>
    </article>
  );
}

function Metric({ label, children, sub, tone }: { label: string; children: React.ReactNode; sub?: string; tone?: string }) {
  return (
    <div className="grid min-w-0 gap-0.5">
      <span className="text-[9.5px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</span>
      <span className={cn("num font-mono text-[14px] font-medium", tone)}>{children}</span>
      {sub && <span className="num truncate text-[10.5px] text-faint">{sub}</span>}
    </div>
  );
}
