import { motion } from "motion/react";
import type { ReactNode } from "react";
import { cn } from "@/lib/cn";
import { price as fmtPrice } from "@/lib/format";
import { DotMatrixText } from "@/motion/fx/DotMatrixText";
import { stagger, tween } from "@/motion/tokens";
import { useReducedFx } from "@/motion/useReducedFx";
import type { SharedSetup, SharedStats, SharedTrade, SharePayload } from "../contract";
import { fmtMove, fmtPct, fmtR, METRIC_LABEL } from "../format";
import { SHARED } from "../strings";

const RESULT = { win: "Gewinn", loss: "Verlust", be: "Break-even", open: "Offen" } as const;
const STOP_LABEL = { box: "Boxkante", struktur: "Struktur", atr: "ATR", fix: "Fester Abstand" } as const;
const ACCOUNT_LABEL = { makro: "Makro", scalp: "Scalp", both: "Makro + Scalp" } as const;

const dayLabel = (d: string | null) => (d ? new Date(`${d}T12:00:00Z`).toLocaleDateString("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }) : "–");
const holdLabel = (min: number) => (min < 60 ? `${min} Min` : min < 1440 ? `${Math.floor(min / 60)} Std ${min % 60 ? `${min % 60} Min` : ""}`.trim() : `${Math.floor(min / 1440)} T ${Math.floor((min % 1440) / 60)} Std`);

/** One fact cell (mono label over a value) – rises in after the hero. */
function Fact({ label, value, tone, index }: { label: string; value: ReactNode; tone?: "win" | "loss" | "mute"; index: number }) {
  const reduced = useReducedFx();
  return (
    <motion.div
      className="min-w-0 rounded-xl border border-line bg-ink-950/50 px-3 py-2"
      initial={reduced ? false : { opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0, transitionEnd: { transform: "none" } }}
      transition={{ ...tween.reveal, delay: 0.12 + Math.min(index, stagger.max) * stagger.cards }}
    >
      <div className="font-mono text-[10px] uppercase tracking-[0.14em] text-faint">{label}</div>
      <div className={cn("num mt-0.5 truncate text-[13.5px] font-medium", tone === "win" ? "text-win" : tone === "loss" ? "text-loss" : tone === "mute" ? "text-mute" : "text-fg")}>{value}</div>
    </motion.div>
  );
}

function Chips({ items, tone = "mute" }: { items: readonly string[]; tone?: "mute" | "loss" }) {
  if (!items.length) return null;
  return (
    <ul className="flex flex-wrap gap-1.5">
      {items.map((t) => (
        <li key={t} className={cn("rounded-full border px-2.5 py-0.5 text-[11.5px]", tone === "loss" ? "border-loss/30 text-loss" : "border-line-2 text-mute")}>
          {t}
        </li>
      ))}
    </ul>
  );
}

/** Small brand footer: what the card is, and that it is redacted. */
function Footer({ children }: { children?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-line pt-3 font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">
      <span className="flex items-center gap-2">
        <span aria-hidden="true" className="size-1.5 rounded-full bg-signal" />
        {SHARED.brand}
      </span>
      {children}
    </div>
  );
}

const heroTone = (v: number | null) => (v == null || v === 0 ? "fg" : v > 0 ? "win" : "loss");

/** A shared trade as the recipient sees it: the R in dot-matrix digits, facts below. */
export function TradeShareCard({ p, className, compact = false, big = false }: { p: SharedTrade; className?: string; compact?: boolean; big?: boolean }) {
  const hero = p.r != null ? fmtR(p.r).replace("−", "-") : p.movePct != null ? fmtMove(p.movePct).replace("−", "-").replace(" %", "%") : p.result === "open" ? "OFFEN" : "-";
  const tone = heroTone(p.r ?? p.movePct);
  const facts: { label: string; value: string; tone?: "win" | "loss" | "mute" }[] = [
    { label: "Ergebnis", value: RESULT[p.result], tone: p.result === "win" ? "win" : p.result === "loss" ? "loss" : undefined },
    { label: "Bewegung", value: fmtMove(p.movePct) },
    { label: "CRV geplant", value: p.rr != null ? p.rr.toLocaleString("de-DE", { maximumFractionDigits: 2 }) : "–" },
    { label: "Checkliste", value: p.checklist ? `${p.checklist.done}/${p.checklist.total}` : "–" },
    { label: "Nach Plan", value: p.followedPlan == null ? "–" : p.followedPlan ? "Ja" : "Nein", tone: p.followedPlan === false ? "loss" : undefined },
    { label: "Bewertung", value: p.rating ? "●".repeat(p.rating) + "○".repeat(5 - p.rating) : "–" },
  ];
  if (p.maeR != null) facts.push({ label: "MAE", value: fmtR(-p.maeR) });
  if (p.mfeR != null) facts.push({ label: "MFE", value: fmtR(p.mfeR) });
  if (p.entry !== undefined) facts.push({ label: SHARED.entry, value: fmtPrice(p.entry) }, { label: SHARED.exit, value: p.exit == null ? "offen" : fmtPrice(p.exit) });
  if (p.stop !== undefined) facts.push({ label: "Stop", value: fmtPrice(p.stop) });
  if (p.target !== undefined) facts.push({ label: "Ziel", value: fmtPrice(p.target) });
  if (p.leverage != null) facts.push({ label: "Hebel", value: `${p.leverage.toLocaleString("de-DE")}x` });
  if (p.holdMin != null) facts.push({ label: "Haltedauer", value: holdLabel(p.holdMin) });
  return (
    <article className={cn("grid gap-4 rounded-2xl border border-line-2 bg-ink-900 p-4 sm:p-5", className)} data-testid="trade-share-card">
      <header className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 font-mono text-[11px] uppercase tracking-[0.14em]">
        <span className="flex min-w-0 items-center gap-2">
          <span className="truncate text-fg">{p.pair === "-" ? "Trade" : p.pair}</span>
          <span className={p.side === "short" ? "text-loss" : "text-win"}>{p.side === "short" ? "▼ Short" : "▲ Long"}</span>
          {p.timeframe && <span className="text-faint">{p.timeframe}</span>}
        </span>
        <span className="text-faint">
          {dayLabel(p.day)}
          {p.time ? ` · ${p.time}` : ""}
        </span>
      </header>
      <div className="grid gap-1">
        <DotMatrixText text={hero} tone={tone} size={compact ? 4 : 6} gap={compact ? 1.5 : 2} label={p.r != null ? fmtR(p.r) : hero} className={cn("max-w-full", big && "sm:hidden")} />
        {big && <DotMatrixText text={hero} tone={tone} size={9} gap={3} decorative className="hidden max-w-full sm:inline-flex" />}
        <span className="font-mono text-[10.5px] uppercase tracking-[0.16em] text-faint">{p.r != null ? "R-Multiple" : p.movePct != null ? "Kursbewegung" : "Ergebnis"}</span>
      </div>
      <div className={cn("grid gap-2", compact ? "grid-cols-2 sm:grid-cols-3" : "grid-cols-2 sm:grid-cols-3")}>
        {facts.map((f, i) => (
          <Fact key={f.label} index={i} {...f} />
        ))}
      </div>
      {(p.setups?.length || p.tags?.length || p.mistakes?.length || p.emotion) && (
        <div className="grid gap-2">
          <Chips items={[...(p.setups ?? []), ...(p.tags ?? []), ...(p.emotion ? [p.emotion] : [])]} />
          <Chips items={p.mistakes ?? []} tone="loss" />
        </div>
      )}
      <Footer>{!compact && <span>R statt Euro</span>}</Footer>
    </article>
  );
}

function List({ title, items }: { title: string; items: readonly string[] }) {
  if (!items.length) return null;
  return (
    <section className="grid gap-1.5">
      <h3 className="font-mono text-[10.5px] uppercase tracking-[0.14em] text-faint">{title}</h3>
      <ul className="grid gap-1">
        {items.map((t, i) => (
          <li key={`${i}-${t}`} className="flex gap-2 text-[13px] leading-snug text-fg">
            <span aria-hidden="true" className="mt-[7px] size-1 shrink-0 rounded-full bg-mute" />
            {t}
          </li>
        ))}
      </ul>
    </section>
  );
}

/** A shared Entscheidungsgrundlage: name, rules, risk model, optional R figures. */
export function SetupShareCard({ p, className }: { p: SharedSetup; className?: string }) {
  const r = p.risk;
  const facts = [
    ...(p.stats ? [{ label: "Trades", value: String(p.stats.trades) }, { label: "Trefferquote", value: fmtPct(p.stats.winRate) }, { label: "Erwartung", value: fmtR(p.stats.expectancyR), tone: (p.stats.expectancyR ?? 0) > 0 ? ("win" as const) : (p.stats.expectancyR ?? 0) < 0 ? ("loss" as const) : undefined }] : []),
    ...(r?.riskPct != null ? [{ label: "Risiko", value: `${r.riskPct.toLocaleString("de-DE")} %` }] : []),
    ...(r?.minRR != null ? [{ label: "CRV min.", value: r.minRR.toLocaleString("de-DE") }] : []),
    ...(r?.maxLeverage != null ? [{ label: "Hebel max.", value: `${r.maxLeverage}x` }] : []),
    ...(r?.stop ? [{ label: "Stop", value: STOP_LABEL[r.stop] }] : []),
  ];
  return (
    <article className={cn("grid gap-4 rounded-2xl border border-line-2 bg-ink-900 p-4 sm:p-5", className)} data-testid="setup-share-card">
      <header className="grid gap-1.5">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
          <span aria-hidden="true" className="size-2 rounded-full" style={{ background: p.color }} />
          Setup · {ACCOUNT_LABEL[p.account]}
          {p.tf.length > 0 && <span>· {p.tf.join(" ")}</span>}
        </span>
        <h3 className="text-[19px] font-semibold tracking-tight [overflow-wrap:anywhere]">{p.name}</h3>
        {p.desc && <p className="text-[13px] leading-relaxed text-mute">{p.desc}</p>}
      </header>
      {facts.length > 0 && (
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
          {facts.map((f, i) => (
            <Fact key={f.label} index={i} {...f} />
          ))}
        </div>
      )}
      <List title={SHARED.checklist} items={p.checklist} />
      <List title="Einstieg" items={p.entryCriteria} />
      <List title="Ausstieg" items={p.exitCriteria} />
      <Chips items={[...p.markets, ...p.tags]} />
      <Footer />
    </article>
  );
}

/** A trader's 90-day figures. */
export function StatsShareCard({ p, className }: { p: SharedStats; className?: string }) {
  const facts = [
    { label: METRIC_LABEL.expectancy, value: fmtR(p.expectancyR), tone: (p.expectancyR ?? 0) > 0 ? ("win" as const) : (p.expectancyR ?? 0) < 0 ? ("loss" as const) : undefined },
    { label: METRIC_LABEL.winrate, value: fmtPct(p.winRate) },
    { label: METRIC_LABEL.discipline, value: fmtPct(p.discipline) },
    { label: METRIC_LABEL.consistency, value: fmtPct(p.consistency) },
  ];
  return (
    <article className={cn("grid gap-4 rounded-2xl border border-line-2 bg-ink-900 p-4 sm:p-5", className)} data-testid="stats-share-card">
      <header className="flex items-baseline justify-between gap-3 font-mono text-[11px] uppercase tracking-[0.14em] text-faint">
        <span className="text-fg">{p.windowDays} Tage</span>
        <span>{p.trades} Trades</span>
      </header>
      <DotMatrixText text={p.expectancyR != null ? fmtR(p.expectancyR).replace("−", "-") : "--"} tone={heroTone(p.expectancyR)} size={6} gap={2} label={fmtR(p.expectancyR)} />
      <div className="grid grid-cols-2 gap-2">
        {facts.map((f, i) => (
          <Fact key={f.label} index={i} {...f} />
        ))}
      </div>
      <Footer />
    </article>
  );
}

export function PayloadCard({ p, className, big = false }: { p: SharePayload; className?: string; big?: boolean }) {
  return p.kind === "trade" ? <TradeShareCard p={p} className={className} big={big} /> : p.kind === "setup" ? <SetupShareCard p={p} className={className} /> : <StatsShareCard p={p} className={className} />;
}
