/**
 * "Fehler-Kosten": what each mistake costs compared with your own clean trades (other journal `insights.tsx:61-112`,
 * extended). Tags = the trade's own `mistakes` (`settings.mistakes` vocabulary) plus mistakes the journal recognises
 * by itself from fields you already fill in (marked "automatisch"). A trade with two tags counts in both rows.
 *   excess(m)  = Σ P&L(trades with m) − n(m) · Ø P&L(clean trades)
 *   excessR(m) = Σ R(trades with m and R) − nR(m) · Ø R(clean trades)
 * clean = closed trades without any mistake (manual or automatic).
 */
import type { EnrichedTrade, Setup } from "../types";
import { aggregate, type Agg } from "../agg";
import { leverageOverRule } from "../derive";
import { isFin } from "@/lib/format";
import { accountOf } from "./shared";
import { snapOf } from "./signal";

/** Automatic tags. Four of them reuse the labels of the default mistake list, so a manual and an automatic tag merge. */
export const AUTO_MISTAKES = {
  noStop: "Kein Stop",
  leverage: "Zu großer Hebel",
  plan: "Gegen den Plan",
  fomo: "FOMO-Einstieg",
  revenge: "Revenge-Trade",
  checklist: "Checkliste unvollständig",
  noSetup: "Ohne Grundlage",
  againstCheck: "Gegen Einstiegs-Check",
  bigLoss: "Verlust größer als 1R",
} as const;

/** How each automatic tag is recognised (shown in the card's explanation). */
export const AUTO_RULES: readonly [string, string][] = [
  [AUTO_MISTAKES.noStop, "kein Stop eingetragen"],
  [AUTO_MISTAKES.leverage, "Hebel über der Regel (Scalp > 4×, Makro > 5×)"],
  [AUTO_MISTAKES.plan, "„Plan befolgt“ auf Nein"],
  [AUTO_MISTAKES.fomo, "Gefühl FOMO"],
  [AUTO_MISTAKES.revenge, "Gefühl Revenge"],
  [AUTO_MISTAKES.checklist, "Checkliste nicht vollständig abgehakt"],
  [AUTO_MISTAKES.noSetup, "keine Entscheidungsgrundlage gewählt"],
  [AUTO_MISTAKES.againstCheck, "Einstiegs-Check war beim Einstieg nicht gültig"],
  [AUTO_MISTAKES.bigLoss, "Verlust über 1,1 R (Stop verschoben oder Slippage)"],
];

/** Mistakes the journal derives from a trade's own fields. */
export function autoMistakes(t: EnrichedTrade, knownSetups: ReadonlySet<string>): string[] {
  const out: string[] = [];
  if (!(t.stop && t.stop > 0)) out.push(AUTO_MISTAKES.noStop);
  if (leverageOverRule(t.leverage, accountOf(t))) out.push(AUTO_MISTAKES.leverage);
  if (t.followedPlan === false) out.push(AUTO_MISTAKES.plan);
  if (t.emotion === "FOMO") out.push(AUTO_MISTAKES.fomo);
  if (t.emotion === "Revenge") out.push(AUTO_MISTAKES.revenge);
  if (t.complete === false) out.push(AUTO_MISTAKES.checklist);
  if (!(t.setups || []).some((id) => knownSetups.has(id))) out.push(AUTO_MISTAKES.noSetup);
  const s = snapOf(t);
  if (s && !s.valid) out.push(AUTO_MISTAKES.againstCheck);
  if (isFin(t.r) && t.r < -1.1) out.push(AUTO_MISTAKES.bigLoss);
  return out;
}

/** The trade's manual tags (`trade.mistakes`, trimmed, de-duplicated). */
export function manualMistakes(t: Pick<EnrichedTrade, "mistakes">): string[] {
  const out: string[] = [];
  for (const m of Array.isArray(t.mistakes) ? t.mistakes : []) {
    if (typeof m !== "string") continue;
    const v = m.trim();
    if (v && !out.includes(v)) out.push(v);
  }
  return out;
}

export interface TradeMistakes {
  tags: string[];
  /** tags that are only automatic on this trade */
  autoOnly: Set<string>;
}

/** Manual ∪ automatic tags of a trade. */
export function tradeMistakes(t: EnrichedTrade, knownSetups: ReadonlySet<string>, withAuto = true): TradeMistakes {
  const manual = manualMistakes(t);
  const tags = [...manual];
  const autoOnly = new Set<string>();
  if (withAuto)
    for (const m of autoMistakes(t, knownSetups))
      if (!tags.includes(m)) {
        tags.push(m);
        autoOnly.add(m);
      }
  return { tags, autoOnly };
}

export interface MistakeRow {
  tag: string;
  n: number;
  /** trades on which the tag was set by hand */
  manual: number;
  /** trades on which the tag is only automatic */
  auto: number;
  g: Agg;
  /** P&L lost (< 0) or gained against clean trades */
  excess: number;
  /** same in R (trades with R only), `null` without any R */
  excessR: number | null;
  /** n / closed trades */
  share: number;
  trades: EnrichedTrade[];
}

export interface MistakeReport {
  /** most expensive first */
  rows: MistakeRow[];
  clean: Agg;
  /** closed trades with at least one tag */
  tagged: number;
  total: number;
  /** the most expensive tag when it cost money (`excess < 0`) */
  leak: MistakeRow | null;
}

export function mistakeReport(closed: readonly EnrichedTrade[], setups: readonly Pick<Setup, "id">[], withAuto = true): MistakeReport {
  const known = new Set(setups.map((s) => s.id));
  const per = new Map<string, { trades: EnrichedTrade[]; manual: number; auto: number }>();
  const clean: EnrichedTrade[] = [];
  for (const t of closed) {
    const { tags, autoOnly } = tradeMistakes(t, known, withAuto);
    if (!tags.length) {
      clean.push(t);
      continue;
    }
    for (const m of tags) {
      const p = per.get(m) ?? { trades: [], manual: 0, auto: 0 };
      p.trades.push(t);
      if (autoOnly.has(m)) p.auto++;
      else p.manual++;
      per.set(m, p);
    }
  }
  const cg = aggregate(clean);
  const cleanR = cg.avgR;
  const rows: MistakeRow[] = [...per].map(([tag, p]) => {
    const g = aggregate(p.trades);
    const excess = cg.n && cg.exp != null ? g.net - g.n * cg.exp : g.net;
    let excessR: number | null = null;
    if (g.rN) {
      const rSum = (g.avgR ?? 0) * g.rN;
      excessR = cleanR != null ? rSum - g.rN * cleanR : rSum;
    }
    return { tag, n: g.n, manual: p.manual, auto: p.auto, g, excess, excessR, share: closed.length ? g.n / closed.length : 0, trades: p.trades };
  });
  rows.sort((a, b) => a.excess - b.excess || b.n - a.n || a.tag.localeCompare(b.tag, "de"));
  const worst = rows[0];
  return { rows, clean: cg, tagged: closed.length - clean.length, total: closed.length, leak: worst && worst.excess < 0 ? worst : null };
}
