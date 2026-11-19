/**
 * "Einträge durchgehen" (Paket F2) – the model behind the journal card of the reports: the closed trades of the shown period as a list
 * to turn through one entry at a time ("Eintrag 06 von 12"), each with what the journal really holds – setups and tags the trader gave it,
 * the plan numbers, the R and the net result, and the process facts (stop, checklist, plan followed, review). Nothing is invented: a field
 * the trade does not have reads "–" or is left out, a trade without a stop has no R (it says so), a loss stays a loss. Pure.
 */
import { reviewed } from "../coach/recommendations";
import type { EnrichedTrade, Settings } from "../types";
import { tradeTime } from "@/lib/dates";

export type EntryTone = "win" | "loss" | "mute";

export interface EntryView {
  id: string;
  /** 1-based position in the list and the list's length ("Eintrag 6 von 12") */
  n: number;
  of: number;
  /** "BTC/USDT" */
  pair: string;
  side: "long" | "short";
  /** "Di, 12.05.2026 · 10:00" */
  when: string;
  /** setup names the trader gave this trade (an id the journal no longer knows is dropped) */
  setups: string[];
  /** free tags, as typed */
  tags: string[];
  /** R of the trade, `null` without a stop (no R is defined then) */
  r: number | null;
  /** net P&L after fees and funding, `null` while unknown */
  net: number | null;
  /** loss = red, win = green, flat / unknown = grey – the SAME for every entry, nothing dressed up */
  tone: EntryTone;
  plan: { entry: number | null; stop: number | null; target: number | null; exit: number | null };
  process: {
    hasStop: boolean;
    /** `null` = the trade has no checklist */
    checklist: { checked: number; total: number } | null;
    /** `null` = not noted */
    followedPlan: boolean | null;
    reviewed: boolean;
  };
  /** the trader's own words about it (reason, else note), cut to a short excerpt; `""` when there is none */
  excerpt: string;
}

const fin = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const DAYS = ["So", "Mo", "Di", "Mi", "Do", "Fr", "Sa"] as const;
const p2 = (n: number): string => String(n).padStart(2, "0");

/** Zero-padded position for the outline numeral ("06"). */
export const pad2 = (n: number): string => p2(Math.max(0, Math.floor(n)));

/** The entries of a period: its closed trades, oldest first (a stable tie-break by id). */
export function entryList<T extends Pick<EnrichedTrade, "id" | "date" | "createdAt" | "result">>(trades: readonly T[]): T[] {
  return trades
    .filter((t) => t.result !== "open")
    .sort((a, b) => +tradeTime(a) - +tradeTime(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

/** Entry `index` (0-based) of `list` as the card shows it; `null` for an index outside the list. */
export function entryView(list: readonly EnrichedTrade[], index: number, settings: Pick<Settings, "setups">): EntryView | null {
  const t = list[index];
  if (!t) return null;
  const d = tradeTime(t);
  const names = new Map(settings.setups.map((s) => [s.id, s.name]));
  const net = fin(t.pnl) ? t.pnl : null;
  const text = (t.reason || t.notes || "").trim().replace(/\s+/g, " ");
  return {
    id: t.id,
    n: index + 1,
    of: list.length,
    pair: t.pair || "–",
    side: t.side === "short" ? "short" : "long",
    when: Number.isNaN(+d) ? "–" : `${DAYS[d.getDay()]}, ${p2(d.getDate())}.${p2(d.getMonth() + 1)}.${d.getFullYear()} · ${p2(d.getHours())}:${p2(d.getMinutes())}`,
    setups: (t.setups ?? []).map((id) => names.get(id)).filter((n): n is string => !!n),
    tags: (t.tags ?? []).filter((x) => typeof x === "string" && x.trim() !== ""),
    r: fin(t.r) ? t.r : null,
    net,
    tone: net == null || net === 0 ? "mute" : net > 0 ? "win" : "loss",
    plan: { entry: fin(t.entry) ? t.entry : null, stop: fin(t.stop) && t.stop > 0 ? t.stop : null, target: fin(t.target) ? t.target : null, exit: fin(t.exit) ? t.exit : null },
    process: {
      hasStop: fin(t.stop) && t.stop > 0,
      checklist: t.complete === null ? null : { checked: t.checked, total: t.items.length },
      followedPlan: t.followedPlan,
      reviewed: reviewed(t),
    },
    excerpt: text.length > 140 ? `${text.slice(0, 139).trimEnd()}…` : text,
  };
}

/** The index after a step of `delta`: stays inside the list (no wrap – "Eintrag 12 von 12" is the end). */
export function stepIndex(index: number, delta: number, total: number): number {
  if (total <= 0) return 0;
  return Math.min(total - 1, Math.max(0, index + delta));
}

/** A swipe as a step: left → next (+1), right → previous (−1); mostly-vertical or short moves (scrolling, a tap) are no step (0). */
export function swipeStep(dx: number, dy: number, min = 48): -1 | 0 | 1 {
  if (Math.abs(dx) < min || Math.abs(dx) < Math.abs(dy) * 1.4) return 0;
  return dx < 0 ? 1 : -1;
}

/** Keyboard: ← / → step, Home / End jump; anything else is no navigation (`null`). */
export function keyStep(key: string, index: number, total: number): number | null {
  if (key === "ArrowRight") return stepIndex(index, 1, total);
  if (key === "ArrowLeft") return stepIndex(index, -1, total);
  if (key === "Home") return 0;
  if (key === "End") return Math.max(0, total - 1);
  return null;
}

/** The cumulative net of the entries (for the quiet curve behind the card): one point per entry, starting at 0. */
export function entryCurve(list: readonly Pick<EnrichedTrade, "pnl">[]): number[] {
  const out = [0];
  let s = 0;
  for (const t of list) out.push((s += fin(t.pnl) ? t.pnl : 0));
  return out;
}
