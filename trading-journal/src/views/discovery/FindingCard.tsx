/**
 * One finding of the Muster-Entdecker as a card: a traffic-light dot with the stage in words (never colour alone), the
 * pattern in plain language with its rates and sample, how much of the winners / losers it covers, whether the sign holds in
 * time, the figures of both parts of the data, the reason when it is not confirmed – and, for a confirmed one the backtest can
 * evaluate, the button that tests it as a filter. Pure view of a `Finding`; it computes nothing.
 */
import { useId, useState } from "react";
import { findingToFilter, type PatternFilterSpec } from "@/domain/discovery/filter";
import { condsText, findingSentence, partText, pctText, REASON_TEXT, rText, TIER_LABEL } from "@/domain/discovery/text";
import type { Finding } from "@/domain/discovery/types";
import { cn } from "@/lib/cn";
import { Badge, type BadgeTone } from "@/primitives/Badge";
import { Button } from "@/primitives/Button";
import { Collapse } from "@/primitives/Expander";
import { DISC } from "./strings";

const F = DISC.finding;

/** Result of "Mit diesem Filter testen", given by the host (the card only shows it). */
export interface FilterTestState {
  /** `Finding.id` the test belongs to */
  id: string;
  status: "running" | "done" | "error";
  text: string;
}

const dec = (v: number, d: number): string => v.toFixed(d).replace(".", ",").replace("-", "−");
const ppText = (v: number | null): string => (v == null ? "–" : `${v > 0 ? "+" : ""}${dec(v * 100, 0)} Pp.`);
const ci = (c: { lo: number; hi: number } | null, pct: boolean): string => (c ? (pct ? `${Math.round(c.lo * 100)}–${Math.round(c.hi * 100)} %` : `${dec(c.lo, 2)} bis ${dec(c.hi, 2)} R`) : "–");
/** p / q for people: tiny values as "< 0,001". */
export const smallP = (v: number | null): string => (v == null ? "–" : v < 0.001 ? "< 0,001" : dec(v, v < 0.01 ? 3 : 2));

const TIER_TONE: Record<Finding["tier"], BadgeTone> = { confirmed: "win", hint: "warn", rejected: "mute" };
const DOT: Record<Finding["tier"], string> = { confirmed: "bg-win", hint: "bg-warn", rejected: "border border-faint bg-transparent" };

export function FindingCard({ f, tested, onTestFilter, filterTest }: { f: Finding; tested: number; onTestFilter?: (spec: PatternFilterSpec, f: Finding) => void; filterTest?: FilterTestState | null }) {
  const [open, setOpen] = useState(false);
  const region = useId();
  const conv = f.tier === "confirmed" && onTestFilter ? findingToFilter(f) : null;
  const test = filterTest && filterTest.id === f.id ? filterTest : null;
  const agree = f.blocks.filter((b) => b === 1).length;
  const a = f.all;
  return (
    <li className="grid gap-3 rounded-xl border border-line bg-ink-950/50 p-3.5" data-testid="discovery-finding" data-tier={f.tier} data-side={f.side} data-id={f.id}>
      <div className="flex flex-wrap items-center gap-2">
        <span aria-hidden="true" className={cn("size-2.5 shrink-0 rounded-full", DOT[f.tier])} />
        <Badge tone={TIER_TONE[f.tier]} title={`Ampel: ${F.ampel[f.tier]}`}>
          {TIER_LABEL[f.tier]}
        </Badge>
        {f.nonObvious && <Badge tone="steel">{F.nonObvious}</Badge>}
        {f.obscure && <Badge tone="mute">{F.obscure}</Badge>}
        {f.postEntry && <Badge tone="warn">{F.postEntry}</Badge>}
      </div>

      <p className="text-[14px] font-medium leading-snug text-fg" data-testid="discovery-finding-text">
        {findingSentence(f)}
      </p>

      <dl className="grid grid-cols-2 gap-x-4 gap-y-2 sm:grid-cols-4">
        <Stat label={F.sample} value={`n = ${a.n}`} sub={`von ${a.total}`} />
        <Stat label={F.rate} value={pctText(a.winRate)} sub={`${F.rateNote} ${ci(a.winCi, true)}`} />
        <Stat label={F.avgR} value={rText(a.avgR)} sub={`Spanne ${ci(a.rCi, false)}`} />
        <Stat label={F.diff} value={ppText(a.diffWinRate)} sub={`${rText(a.diffR)} gegenüber ${rText(a.baseAvgR)}`} tone={a.diffR == null ? undefined : a.diffR > 0 ? "text-win" : a.diffR < 0 ? "text-loss" : undefined} />
      </dl>

      {f.shareWinners != null && f.shareLosers != null && <p className="text-[12.5px] leading-snug text-mute">{F.shares(pctText(f.shareWinners), pctText(f.shareLosers))}</p>}

      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-[12px] text-mute">
        <span className="inline-flex items-center gap-1" role="img" aria-label={f.blocks.map((b, i) => `Zeitabschnitt ${i + 1}: ${F.block[String(b)]}`).join("; ")} data-testid="discovery-blocks">
          {f.blocks.map((b, i) => (
            <span key={i} aria-hidden="true" className={cn("grid size-5 place-items-center rounded-md border text-[10px] font-semibold", b === 1 ? "border-win/40 text-win" : b === -1 ? "border-loss/40 text-loss" : "border-line-2 text-faint")}>
              {b === 1 ? "✓" : b === -1 ? "✗" : "–"}
            </span>
          ))}
        </span>
        <span>{F.stability(agree, f.blocks.length)}</span>
      </div>

      {f.tier !== "confirmed" && f.reasons.length > 0 && (
        <ul className="grid gap-0.5 text-[12.5px] leading-snug text-mute" data-testid="discovery-reasons">
          {f.reasons.map((r) => (
            <li key={r}>{REASON_TEXT[r]}</li>
          ))}
        </ul>
      )}

      <div className="flex flex-wrap items-center gap-2">
        {conv?.ok && (
          <Button size="sm" variant="primary" onClick={() => onTestFilter!(conv.spec, f)} disabled={test?.status === "running"} data-testid="discovery-filter-test" aria-describedby={`${region}-note`}>
            {test?.status === "running" ? F.testFilterBusy : F.testFilter}
          </Button>
        )}
        <Button size="sm" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-controls={region} data-testid="discovery-details-toggle">
          {open ? F.detailsClose : F.details}
        </Button>
      </div>
      {conv?.ok && (
        <p id={`${region}-note`} className="text-[11.5px] leading-snug text-faint">
          {F.testNote}
        </p>
      )}
      {conv && !conv.ok && (
        <p className="text-[12px] leading-snug text-mute" data-testid="discovery-filter-why">
          {conv.reason}
        </p>
      )}
      {test && (
        <p role="status" className={cn("rounded-lg border border-line px-3 py-2 text-[12.5px] leading-snug", test.status === "error" ? "text-warn" : "text-mute")} data-testid="discovery-filter-result" data-status={test.status}>
          {test.text}
        </p>
      )}

      <Collapse open={open} id={region}>
        <div className="grid gap-2.5 border-t border-line pt-3" data-testid="discovery-details">
          <p className="text-[12px] leading-snug text-mute">{condsText(f.conds)}</p>
          <dl className="grid gap-x-4 gap-y-1.5 text-[12px] sm:grid-cols-2">
            <div>
              <dt className="text-faint">{F.disc}</dt>
              <dd className="num font-mono text-fg/90">{partText(f.disc)}</dd>
            </div>
            <div>
              <dt className="text-faint">{F.conf}</dt>
              <dd className="num font-mono text-fg/90">{f.conf ? partText(f.conf) : F.noConf}</dd>
            </div>
          </dl>
          <p className="text-[11.5px] leading-snug text-faint">{F.stat(smallP(f.q), tested)}</p>
          {f.confP != null && <p className="text-[11.5px] leading-snug text-faint">{F.confStat(smallP(f.confQ ?? f.confP))}</p>}
        </div>
      </Collapse>
    </li>
  );
}

function Stat({ label, value, sub, tone }: { label: string; value: string; sub?: string; tone?: string }) {
  return (
    <div className="grid min-w-0 content-start gap-0.5">
      <dt className="text-[10px] font-semibold uppercase tracking-[0.1em] text-faint">{label}</dt>
      <dd className={cn("num font-mono text-[15px] font-medium leading-tight", tone)}>{value}</dd>
      {sub && <dd className="num text-[11px] leading-snug text-faint">{sub}</dd>}
    </div>
  );
}
