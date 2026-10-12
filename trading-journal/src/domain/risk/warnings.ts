/**
 * Risk warnings (P05), pure: `riskWarnings(state)` turns the limit report, the pause, the exposure, correlated
 * clusters and close liquidations into short German warnings (breach first); `riskPreview(draft, ctx)` checks a trade
 * BEFORE it is saved (the editor, P14 binds it via `useRiskPreview`). Nothing here blocks the journal.
 */
import { n0 } from "@/lib/format";
import type { AccountId, Side } from "../types";
import type { RiskLimits } from "./config";
import type { ClusterRisk } from "./correlation";
import type { ExposureReport } from "./exposure";
import { liqBeforeStop, liquidationPrice } from "./liquidation";
import { stateOf, worstState, type Cooldown, type LimitReport, type LimitState } from "./limits";
import { rrCalc } from "./sizing";

export type WarningTone = "warn" | "breach";

export interface RiskWarning {
  /** stable key (toast dedupe): `limit:day`, `cooldown`, `cluster:BTCUSDT+ETHUSDT:long` … */
  key: string;
  tone: WarningTone;
  title: string;
  detail: string;
  source: "limit" | "cooldown" | "exposure" | "correlation" | "liquidation" | "preview";
}

export interface LiqProximity {
  label: string;
  distPct: number;
  distAtr: number | null;
}

export interface RiskState {
  report: LimitReport;
  exposure?: ExposureReport | null;
  clusters?: readonly ClusterRisk[];
  liquidations?: readonly LiqProximity[];
  now: number;
}

/** Liquidation closer than this (fraction of the price) warns, closer than `LIQ_BREACH` is a breach. */
export const LIQ_WARN = 0.05;
export const LIQ_BREACH = 0.02;

const pct = (x: number): string => `${(Math.round(x * 1000) / 10).toString().replace(".", ",")} %`;

/** "mm:ss" (or "h:mm:ss") until `endsAt`. */
export function clockText(ms: number): string {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return h ? `${h}:${mm}:${String(sec).padStart(2, "0")}` : `${mm}:${String(sec).padStart(2, "0")}`;
}

export function cooldownWarning(c: Cooldown, now: number): RiskWarning {
  return {
    key: `cooldown:${c.reason}:${c.since}`,
    tone: "breach",
    title: c.reason === "day" ? "Tageslimit erreicht – Pause bis morgen" : `${c.losses} Verluste in Folge – kurze Pause`,
    detail: c.reason === "day" ? "Für heute ist Schluss. Morgen startest du frisch." : `Noch ${clockText(c.endsAt - now)}. Atmen, Plan lesen, dann weiter.`,
    source: "cooldown",
  };
}

/** All warnings of the state, breach first. */
export function riskWarnings(state: RiskState): RiskWarning[] {
  const out: RiskWarning[] = [];
  const { report } = state;
  for (const r of report.rows) {
    if (r.state === "ok") continue;
    out.push({ key: `limit:${r.key}`, tone: r.state, title: r.state === "breach" ? `${r.label}: Grenze erreicht` : `${r.label}: ${pct(Math.min(r.ratio, 9.99))} der Grenze`, detail: r.detail, source: "limit" });
  }
  if (report.cooldown && report.cooldown.endsAt > state.now) out.push(cooldownWarning(report.cooldown, state.now));
  const ex = state.exposure;
  if (ex && ex.legs.length >= 2 && ex.byAsset.length >= 2 && ex.byAsset[0]!.share >= 0.6) {
    const top = ex.byAsset[0]!;
    out.push({ key: `exposure:concentration:${top.key}`, tone: "warn", title: `${pct(top.share)} deines Exposures in ${top.key}`, detail: "Ein Asset trägt fast alles – ein Move trifft alle Positionen gleich.", source: "exposure" });
  }
  if (ex) {
    for (const a of ex.crossVenue) out.push({ key: `exposure:cross:${a}`, tone: "warn", title: `${a} auf mehreren Börsen offen`, detail: "Zusammengerechnet ist die Position größer, als es auf jeder Börse einzeln aussieht.", source: "exposure" });
  }
  for (const c of state.clusters ?? []) {
    out.push({
      key: `cluster:${c.symbols.join("+")}:${c.side}`,
      tone: "warn",
      title: `${c.symbols.length} korrelierte ${c.side === "long" ? "Longs" : "Shorts"}`,
      detail: `${c.symbols.join(", ")} laufen zusammen (ρ ≈ ${c.cluster.avg.toFixed(2).replace(".", ",")}) – das ist eher ein großer Trade als mehrere.`,
      source: "correlation",
    });
  }
  for (const l of state.liquidations ?? []) {
    if (l.distPct >= LIQ_WARN) continue;
    out.push({ key: `liq:${l.label}`, tone: l.distPct < LIQ_BREACH ? "breach" : "warn", title: `Liquidation nah: ${l.label}`, detail: `Nur ${pct(l.distPct)} bis zur Liquidation${l.distAtr != null ? ` (${l.distAtr.toFixed(1).replace(".", ",")} ATR)` : ""}.`, source: "liquidation" });
  }
  return out.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "breach" ? -1 : 1));
}

// ── preview of a trade before it is saved ───────────────────────────────────────────────────────────────────────

/** The trade fields the preview reads (a `TradeDraft` / editor form). */
export interface RiskDraft {
  account?: AccountId;
  side?: Side;
  status?: "open" | "closed";
  entry?: number | null;
  stop?: number | null;
  target?: number | null;
  size?: number | null;
  qty?: number | null;
  leverage?: number | null;
  marginMode?: "isolated" | "cross";
  margin?: number | null;
}

export interface RiskPreview {
  /** money to the stop (null without entry / stop / size) */
  riskAmount: number | null;
  /** ÷ the account's start capital */
  riskPct: number | null;
  rr: number | null;
  rrNet: number | null;
  /** approximate liquidation (isolated, from the leverage) */
  liqPrice: number | null;
  state: LimitState;
  warnings: RiskWarning[];
}

export interface PreviewContext {
  limits: RiskLimits;
  /** the limit report of the trade's ACCOUNT (scope = account) */
  report: LimitReport;
  capital: number;
  now: number;
}

const fin = (x: unknown): x is number => typeof x === "number" && Number.isFinite(x);

/** Checks a trade before it is saved (warnings only). */
export function riskPreview(draft: RiskDraft, ctx: PreviewContext): RiskPreview {
  const { limits, report, capital, now } = ctx;
  const acc: AccountId = draft.account ?? "scalp";
  const side: Side = draft.side ?? "long";
  const entry = fin(draft.entry) && draft.entry > 0 ? draft.entry : null;
  const stop = fin(draft.stop) && draft.stop > 0 ? draft.stop : null;
  const qty = fin(draft.qty) && draft.qty > 0 ? draft.qty : entry && fin(draft.size) && draft.size > 0 ? draft.size / entry : null;
  const riskAmount = entry && stop && qty ? Math.abs(entry - stop) * qty : null;
  const riskPct = riskAmount != null && capital > 0 ? riskAmount / capital : null;
  const rr = entry && stop && fin(draft.target) && draft.target > 0 ? rrCalc({ entry, stop, target: draft.target, side, feePct: limits.feePct, slippagePct: limits.slippagePct }) : null;
  const lev = fin(draft.leverage) && draft.leverage > 0 ? draft.leverage : null;
  const liq = entry && qty && (lev || (fin(draft.margin) && draft.margin > 0)) ? liquidationPrice({ side, entry, qty, leverage: lev, margin: draft.margin, mode: draft.marginMode === "cross" ? "cross" : "isolated", wallet: capital, tiers: limits.tiers }) : null;
  const w: RiskWarning[] = [];
  const isOpenNew = draft.status !== "closed";
  const cur = report.currency;

  if (entry && !stop && isOpenNew) w.push({ key: "preview:nostop", tone: "warn", title: "Kein Stop gesetzt", detail: "Ohne Stop ist das Risiko offen nach unten.", source: "preview" });
  if (riskPct != null && riskPct > limits.maxLossTradePct + 1e-12) {
    w.push({ key: "preview:trade", tone: "breach", title: `Risiko ${pct(riskPct)} – Grenze ${pct(limits.maxLossTradePct)}`, detail: `${n0(riskAmount)} ${cur} bis zum Stop. Kleiner gehen oder Stop enger.`, source: "preview" });
  }
  if (lev != null && lev > limits.leverageRule[acc] + 1e-9) {
    w.push({ key: "preview:leverage", tone: "breach", title: `Hebel ${String(lev).replace(".", ",")}× über deiner Regel (${limits.leverageRule[acc]}×)`, detail: "Die Regel gilt auch für diesen Trade.", source: "preview" });
  }
  if (liq?.price != null && stop && liqBeforeStop(side, stop, liq.price)) {
    w.push({ key: "preview:liq", tone: "breach", title: "Liquidation vor dem Stop", detail: `Liquidation bei ≈ ${n0(liq.price)} liegt vor deinem Stop – der Stop kann nie greifen. Hebel runter.`, source: "preview" });
  }
  if (isOpenNew) {
    const day = report.rows.find((r) => r.key === "day");
    if (day && riskAmount != null && day.used + riskAmount > day.limit + 1e-9 && day.state !== "breach") {
      w.push({ key: "preview:day", tone: "warn", title: "Stop würde dein Tageslimit reißen", detail: `Heute schon ${n0(day.used)} ${cur} weg, mit diesem Stop wären es ${n0(day.used + riskAmount)} von ${n0(day.limit)} ${cur}.`, source: "preview" });
    }
    if (day?.state === "breach") w.push({ key: "preview:daybreach", tone: "breach", title: "Tageslimit schon erreicht", detail: "Heute keinen neuen Trade mehr – morgen ist ein neuer Tag.", source: "preview" });
    const open = report.rows.find((r) => r.key === "openRisk");
    if (open && riskAmount != null && open.used + riskAmount > open.limit + 1e-9) {
      w.push({ key: "preview:open", tone: stateOf((open.used + riskAmount) / open.limit, limits.warnAt) === "breach" ? "breach" : "warn", title: "Offenes Risiko über der Grenze", detail: `Mit diesem Trade ${n0(open.used + riskAmount)} von ${n0(open.limit)} ${cur} offen bis zu den Stops.`, source: "preview" });
    }
    const trades = report.rows.find((r) => r.key === "trades");
    if (trades && trades.used >= trades.limit) w.push({ key: "preview:trades", tone: trades.used + 1 > trades.limit ? "breach" : "warn", title: `Schon ${trades.used} Trades heute`, detail: `Deine Grenze sind ${trades.limit} pro Tag.`, source: "preview" });
    if (report.cooldown && report.cooldown.endsAt > now) w.push(cooldownWarning(report.cooldown, now));
  }
  const sorted = w.sort((a, b) => (a.tone === b.tone ? 0 : a.tone === "breach" ? -1 : 1));
  return {
    riskAmount,
    riskPct,
    rr: rr?.rr ?? null,
    rrNet: rr?.rrNet ?? null,
    liqPrice: liq?.price ?? null,
    state: worstState(sorted.map((x) => x.tone)),
    warnings: sorted,
  };
}
