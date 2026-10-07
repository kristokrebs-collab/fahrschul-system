/**
 * Playbook figures per Entscheidungsgrundlage (Tradezella "Playbook" report, tradezella.md P12) – pure, no React.
 * Everything is derived from data the journal already stores: `aggregate()` (the same numbers as the Hero, the ranking
 * and the explainers), the setup's own checklist ticks (`checks["{setupId}:{itemId}"]`), the manual mistake tags
 * (`trade.mistakes`) and the stored entry check (`trade.signal`, either app's format).
 */
import type { SetupStats } from "@/domain/account";
import { aggregate, type Agg } from "@/domain/agg";
import type { Explanation, ExplainRow, Verdict } from "@/domain/explain";
import { manualMistakes } from "@/domain/insights/mistakes";
import { snapOf } from "@/domain/insights/signal";
import type { EnrichedTrade, Setup } from "@/domain/types";
import { colorClass, DASH, INFINITY_SIGN, n0, n2, pct0, r as fmtR, signed } from "@/lib/format";

export interface PlaybookAdherence {
  /** Checklist items of THIS setup (0 = the setup has no checklist, adherence cannot be measured). */
  items: number;
  /** Trades with this setup whose setup checklist could be ticked (the setup has ≥ 1 item). */
  withList: number;
  /** …of those, every item of THIS setup was ticked ("regeltreu"). */
  full: number;
  /** `full / withList`, null without a checklist or trades. */
  rate: number | null;
  /** Mean share of ticked setup items per trade (0..1), null like `rate`. */
  itemRate: number | null;
  /** Win rate of the rule-true trades vs. the trades with gaps (null when a side is empty). */
  fullWinRate: number | null;
  gapsWinRate: number | null;
}

export interface PlaybookSignal {
  /** Closed trades with this setup that carry a stored entry check. */
  n: number;
  avgScore: number | null;
  avgStrength: number | null;
  /** Share of those checks that were a valid entry. */
  validShare: number | null;
}

export interface PlaybookStats {
  /** The setup's aggregate over its closed trades (same object shape as `SetupStats`). */
  agg: Agg;
  adherence: PlaybookAdherence;
  /** Most frequent manual mistake tag on this setup's trades (ties: first seen). */
  topMistake: { tag: string; n: number } | null;
  signal: PlaybookSignal | null;
}

const hasSetup = (t: Pick<EnrichedTrade, "setups">, id: string): boolean => (t.setups || []).includes(id);

/** Playbook figures of one setup over closed trades (`accountView().closed` – callers pass closed trades only). */
export function playbookStats(setup: Pick<Setup, "id" | "checklist">, closed: readonly EnrichedTrade[]): PlaybookStats {
  const list = closed.filter((t) => hasSetup(t, setup.id));
  const agg = aggregate(list);

  const ids = (setup.checklist ?? []).map((c) => `${setup.id}:${c.id}`);
  const fullList: EnrichedTrade[] = [];
  const gapList: EnrichedTrade[] = [];
  let shareSum = 0;
  if (ids.length) {
    for (const t of list) {
      const ticked = ids.filter((id) => t.checks?.[id] === true).length;
      shareSum += ticked / ids.length;
      (ticked === ids.length ? fullList : gapList).push(t);
    }
  }
  const withList = fullList.length + gapList.length;
  const fullAgg = aggregate(fullList);
  const gapAgg = aggregate(gapList);
  const adherence: PlaybookAdherence = {
    items: ids.length,
    withList,
    full: fullList.length,
    rate: withList ? fullList.length / withList : null,
    itemRate: withList ? shareSum / withList : null,
    fullWinRate: fullAgg.n ? fullAgg.winRate : null,
    gapsWinRate: gapAgg.n ? gapAgg.winRate : null,
  };

  const counts = new Map<string, number>();
  for (const t of list) for (const m of manualMistakes(t)) counts.set(m, (counts.get(m) ?? 0) + 1);
  let topMistake: PlaybookStats["topMistake"] = null;
  for (const [tag, n] of counts) if (!topMistake || n > topMistake.n) topMistake = { tag, n };

  let sn = 0,
    scoreSum = 0,
    strengthSum = 0,
    valid = 0;
  for (const t of list) {
    const s = snapOf(t);
    if (!s) continue;
    sn++;
    scoreSum += s.score;
    strengthSum += s.strength;
    if (s.valid) valid++;
  }
  const signal: PlaybookSignal | null = sn ? { n: sn, avgScore: scoreSum / sn, avgStrength: strengthSum / sn, validShare: valid / sn } : null;

  return { agg, adherence, topMistake, signal };
}

/** Playbook figures from the card's own aggregate only (no trade list at hand): adherence / mistakes / signal unknown. */
export function fromStats(agg: Agg): PlaybookStats {
  return {
    agg,
    adherence: { items: 0, withList: 0, full: 0, rate: null, itemRate: null, fullWinRate: null, gapsWinRate: null },
    topMistake: null,
    signal: null,
  };
}

/** `playbookStats` for every setup, keyed by setup id (one pass per setup over the closed trades). */
export function playbookBySetup(setups: readonly Pick<Setup, "id" | "checklist">[], closed: readonly EnrichedTrade[]): Map<string, PlaybookStats> {
  const out = new Map<string, PlaybookStats>();
  for (const s of setups) out.set(s.id, playbookStats(s, closed));
  return out;
}

/* ------------------------------------------------------------------ display */

export const PLAYBOOK_STRINGS = {
  title: "Playbook",
  open: (name: string) => `Playbook-Werte: ${name}`,
  stats: "Kennzahlen",
  exp: "Erwartung",
  pf: "Profit-Faktor",
  adherence: "Regel-Treue",
  bestWorst: "Bester / Schwächster",
  noList: "ohne Checkliste",
  topMistake: "Häufigster Fehler",
  signal: "Ø Signal-Score",
} as const;

/** Profit factor as text: `∞` for gains without losses, `–` without trades. */
export function pfText(pf: number | null): string {
  if (pf == null) return DASH;
  return pf === Infinity ? INFINITY_SIGN : n2(pf);
}

/** Compact P&L for the tile (`+1.234`), `–` when absent. */
export const pnlText = (v: number | null | undefined): string => (v == null || !Number.isFinite(v) ? DASH : signed(v, 0));

/** Rule adherence as `78 %`, or the "no checklist" hint. */
export function adherenceText(a: PlaybookAdherence): string {
  if (!a.items) return PLAYBOOK_STRINGS.noList;
  return pct0(a.rate);
}

function verdictOf(agg: Agg, a: PlaybookAdherence): Verdict {
  if (!agg.n) return { tone: "mute", text: "Noch keine abgeschlossenen Trades mit dieser Grundlage." };
  if (agg.n < 5) return { tone: "warn", text: `Erst ${agg.n} Trade${agg.n === 1 ? "" : "s"}. Ab etwa 10 Trades lässt sich die Grundlage fair bewerten.` };
  if (a.fullWinRate != null && a.gapsWinRate != null) {
    const d = a.fullWinRate - a.gapsWinRate;
    if (d >= 0.1) return { tone: "win", text: `Regeltreu gewinnst du ${Math.round(d * 100)} Prozentpunkte öfter. Die Checkliste dieser Grundlage wirkt.` };
    if (d <= -0.1) return { tone: "warn", text: "Mit Lücken läuft es hier bisher besser. Prüfe, ob die Punkte dieser Grundlage zu deinem Stil passen." };
  }
  return agg.net > 0 ? { tone: "win", text: "Diese Grundlage verdient Geld. Weiter so, gleiche Regeln." } : { tone: "loss", text: "Diese Grundlage kostet Geld. Regeln schärfen oder seltener handeln." };
}

/** `[label, value, cls?, sub?]` without trailing empty slots. */
function row(label: string, value: string, cls = "", sub = ""): ExplainRow {
  if (sub) return [label, value, cls, sub];
  return cls ? [label, value, cls] : [label, value];
}

/** Explainer of the playbook block (opened from the card): every figure with how it is computed. */
export function explainPlaybook(stats: Pick<SetupStats, "setup">, pb: PlaybookStats, cur: string): Explanation {
  const { agg, adherence: a, topMistake, signal } = pb;
  const rows: ExplainRow[] = [
    row("Trades", String(agg.n)),
    row("Win-Rate", pct0(agg.winRate)),
    row("Erwartung pro Trade", agg.exp == null ? DASH : `${signed(agg.exp, 2)} ${cur}`, colorClass(agg.exp), "Netto ÷ Trades"),
    row("Profit-Faktor", pfText(agg.pf), "", "Summe Gewinne ÷ Summe Verluste"),
    row("Ø R", fmtR(agg.avgR), colorClass(agg.avgR), agg.rN ? `${agg.rN} Trades mit Stop` : "kein Trade mit Stop"),
    row("Ø Gewinn / Ø Verlust", `${n0(agg.avgWin)} / ${n0(agg.avgLoss)}`),
    row(
      "Regel-Treue",
      !a.items ? PLAYBOOK_STRINGS.noList : a.rate == null ? DASH : `${pct0(a.rate)} · ${a.full}/${a.withList}`,
      "",
      "Trades, bei denen alle Punkte dieser Grundlage abgehakt waren",
    ),
    row("Ø abgehakte Punkte", a.itemRate == null ? DASH : pct0(a.itemRate)),
    row("Win-Rate regeltreu / mit Lücken", `${pct0(a.fullWinRate)} / ${pct0(a.gapsWinRate)}`),
    row("Bester Trade", agg.best ? `${signed(agg.best.pnl, 2)} ${cur}` : DASH, colorClass(agg.best?.pnl)),
    row("Schlechtester Trade", agg.worst ? `${signed(agg.worst.pnl, 2)} ${cur}` : DASH, colorClass(agg.worst?.pnl)),
    row("Häufigster Fehler-Tag", topMistake ? `${topMistake.tag} · ${topMistake.n}×` : DASH),
    row("Ø Signal-Score", signal?.avgScore != null ? `${Math.round(signal.avgScore)} · ${signal.n}×` : DASH, "", "Trades mit gespeichertem Einstiegs-Check"),
  ];
  return {
    key: `playbook:${stats.setup.id}`,
    title: PLAYBOOK_STRINGS.title,
    sheetTitle: `${PLAYBOOK_STRINGS.title} · ${stats.setup.name}`,
    what: "Wie diese Grundlage abschneidet, nach dem Prinzip von Tradezellas Playbook-Report: Ergebnis, Erwartung pro Trade, Profit-Faktor und wie konsequent du ihre Checkliste abhakst. Alles aus den abgeschlossenen Trades mit dieser Grundlage.",
    rows,
    verdict: verdictOf(agg, a),
  };
}
