/**
 * "Kosten" (Review F05 / MM-7 / F13): what the trades earned BEFORE fees and funding, what the costs took and what is
 * left – a waterfall of four bars (Brutto → − Gebühren → ± Funding → Netto) that grow in once in view (`spring.enter`,
 * staggered, transform only; reduced motion: at rest), the figures count up (`CountValue`). Fees are what the P&L
 * actually carries (`effectiveFees`: the trade's fees or the Σ of its fill fees). Pure read of `aggregate()`.
 */
import { motion } from "motion/react";
import { memo, useRef } from "react";
import { aggregate } from "@/domain/agg";
import type { EnrichedTrade } from "@/domain/types";
import { cn } from "@/lib/cn";
import { n0 } from "@/lib/format";
import { spring, stagger } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import { Card } from "@/primitives/Card";
import { useSeenOnce } from "@/primitives/revealValue";
import { CountValue } from "./ui";

export const COSTS_STRINGS = {
  title: "Kosten",
  note: "Was deine Trades vor Gebühren und Funding verdient haben – und was die Kosten genommen haben.",
  /** „Brutto vor Kosten“ was cut to „Brutto vor Kost…“ in the 390-px tile; the note above already says „vor Gebühren und Funding“ (P1-18) */
  gross: "Brutto",
  fees: "Gebühren",
  funding: "Funding",
  net: "Netto",
  share: (pct: string) => `Kosten = ${pct} vom Brutto-Gewinn`,
  fundingSplit: (paid: string, received: string) => `gezahlt ${paid} · erhalten ${received}`,
  none: "Keine Gebühren oder Funding erfasst.",
} as const;

interface Row {
  key: "gross" | "fees" | "funding" | "net";
  label: string;
  value: number;
  /** bar from … to (the waterfall) */
  from: number;
  to: number;
  sub?: string;
}

export const CostsCard = memo(function CostsCard({ closed, cur }: { closed: readonly EnrichedTrade[]; cur: string }) {
  const reduced = useReducedFx();
  const ref = useRef<HTMLDivElement>(null);
  const seen = useSeenOnce(ref);
  const g = aggregate(closed);
  const costs = g.fees + g.funding;
  const rows: Row[] = [
    { key: "gross", label: COSTS_STRINGS.gross, value: g.gross, from: 0, to: g.gross },
    { key: "fees", label: COSTS_STRINGS.fees, value: -g.fees || 0, from: g.gross, to: g.gross - g.fees },
    {
      key: "funding",
      label: COSTS_STRINGS.funding,
      value: -g.funding || 0,
      from: g.gross - g.fees,
      to: g.net,
      sub: g.fundingPaid || g.fundingReceived ? COSTS_STRINGS.fundingSplit(`${n0(g.fundingPaid)} ${cur}`, `${n0(g.fundingReceived)} ${cur}`) : undefined,
    },
    { key: "net", label: COSTS_STRINGS.net, value: g.net, from: 0, to: g.net },
  ];
  const lo = Math.min(0, ...rows.map((r) => Math.min(r.from, r.to)));
  const hi = Math.max(1e-9, ...rows.map((r) => Math.max(r.from, r.to)));
  const span = hi - lo || 1;
  const share = g.gross > 0 && costs > 0 ? `${Math.round((costs / g.gross) * 100)} %` : null;
  return (
    <Card title={COSTS_STRINGS.title} note={COSTS_STRINGS.note} data-testid="ana-costs">
      <div ref={ref} className="grid gap-4">
        <ul className="grid grid-cols-2 gap-2 sm:grid-cols-4" aria-label={COSTS_STRINGS.title}>
          {rows.map((r) => (
            <li key={r.key} className="grid min-w-0 content-start gap-1 rounded-2xl border border-line bg-ink-950/50 px-3 py-2.5" data-testid={`ana-cost-${r.key}`} data-value={Math.round(r.value * 100) / 100}>
              <span className="label truncate">{r.label}</span>
              <CountValue
                value={r.value}
                decimals={0}
                signed
                suffix={` ${cur}`}
                revealKey={`ana-cost-${r.key}`}
                className={cn("num truncate font-mono text-[17px] font-medium leading-tight", r.value > 0 ? "text-win" : r.value < 0 ? "text-loss" : "text-fg")}
              />
              {r.sub && <span className="num truncate text-[10.5px] text-faint">{r.sub}</span>}
            </li>
          ))}
        </ul>
        <div className="grid gap-1.5" aria-hidden="true">
          {rows.map((r, i) => {
            const left = (Math.min(r.from, r.to) - lo) / span;
            const width = Math.abs(r.to - r.from) / span;
            return (
              <span key={r.key} className="relative block h-2 overflow-hidden rounded-full bg-white/[0.04]">
                <motion.span
                  className={cn("absolute inset-y-0 rounded-full", r.key === "gross" || r.key === "net" ? (r.to >= 0 ? "bg-win/70" : "bg-loss/70") : r.to <= r.from ? "bg-loss/60" : "bg-win/60")}
                  style={{ left: `${left * 100}%`, width: `${Math.max(width, 0.002) * 100}%`, originX: r.key === "fees" || r.key === "funding" ? 1 : 0 }}
                  initial={reduced ? false : { scaleX: 0 }}
                  animate={{ scaleX: seen || reduced ? 1 : 0 }}
                  transition={{ ...spring.enter, delay: reduced ? 0 : stagger.lead + i * stagger.reveal }}
                />
              </span>
            );
          })}
        </div>
        <p className="text-[12px] text-mute" data-testid="ana-costs-share">
          {g.fees === 0 && g.funding === 0 ? COSTS_STRINGS.none : share ? COSTS_STRINGS.share(share) : `${COSTS_STRINGS.fees} ${n0(g.fees)} ${cur} · ${COSTS_STRINGS.funding} ${n0(g.funding)} ${cur}`}
        </p>
      </div>
    </Card>
  );
});
