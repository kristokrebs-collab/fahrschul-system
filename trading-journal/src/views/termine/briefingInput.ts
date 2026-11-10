/**
 * What the Morgenbriefing reads (F43): the same stores for the Markt card and the assistant, mapped to the plain inputs of
 * `buildBriefing` (`@/domain/events`). The mapping functions are pure (they take the store values), `readBriefingStores`
 * reads them once – without starting a fetch: a symbol whose daily candles are not in the cache is "keine Daten", the
 * assistant never triggers a download.
 */
import { boxesCfgOf } from "@/domain/boxes";
import { type AlertRow, type BriefingInput, type CheckinInput, type KeyLevelInput, type LevelRow, type MarketMove } from "@/domain/events";
import { dayKeyIn } from "@/domain/events/zone";
import { OUTCOME_LABEL, type DeliveryRecord } from "@/domain/keylevels";
import type { DayNotes } from "@/domain/types";
import { SOURCE_LABEL } from "@/ui/SourceStand";
import type { KeyLevelsView } from "@/market/keylevels/store";
import type { MultiDailyView } from "@/market/multiDaily";
import type { Stamped, Ticker24h } from "@/market/types";
import { ownEventsOfSettings } from "@/domain/events";

const DAY = 86_400_000;
const MAX_LEVELS = 6;
/** Daily candles of the watchlist are read for at most this many symbols (the budget of `useMultiDaily`). */
export const BRIEFING_SYMBOLS = 8;

/** The two settings keys the briefing reads (`settings.boxes` is a passthrough key without a declared type). */
export interface BriefingSettings {
  boxes?: unknown;
  events?: unknown;
}

export interface BriefingStores {
  now: number;
  tz: string;
  settings: BriefingSettings;
  days: DayNotes;
  /** the live feed's 24 h ticker and the symbol it belongs to */
  ticker: Stamped<Ticker24h> | undefined;
  liveSymbol: string | null;
  daily: MultiDailyView | null;
  keyLevels: KeyLevelsView | null;
  log: readonly DeliveryRecord[] | null;
}

/** The watchlist symbols the briefing looks at: the live market first, then the scanner's watchlist. */
export function briefingSymbols(settings: BriefingSettings, liveSymbol: string | null): string[] {
  const wl = boxesCfgOf(settings.boxes).watchlist;
  const all = [...(liveSymbol ? [liveSymbol] : []), ...wl];
  return [...new Set(all)].slice(0, BRIEFING_SYMBOLS);
}

/** Moves of the live symbol (24 h ticker) and of the watchlist (last closed UTC day). */
export function marketMoves(s: Pick<BriefingStores, "ticker" | "liveSymbol" | "daily" | "settings">): MarketMove[] {
  const out: MarketMove[] = [];
  const live = s.liveSymbol;
  if (live) {
    const t = s.ticker;
    out.push(
      t && Number.isFinite(t.data.priceChangePercent)
        ? { symbol: live, change: t.data.priceChangePercent / 100, basis: "24h", price: Number.isFinite(t.data.lastPrice) ? t.data.lastPrice : null, asOf: t.asOf, source: SOURCE_LABEL[t.source] }
        : { symbol: live, change: null, basis: "24h", price: null, asOf: null, source: null },
    );
  }
  for (const sym of briefingSymbols(s.settings, live)) {
    if (sym === live) continue;
    const series = s.daily?.series[sym];
    const last = series?.[series.length - 1];
    const prev = series?.[series.length - 2];
    if (last && prev && prev.c > 0) {
      out.push({ symbol: sym, change: last.c / prev.c - 1, basis: "tag", price: last.c, asOf: last.t + DAY, source: s.daily?.viaProxy ? "Binance USDⓈ-M (EU-Proxy), Tageskerzen UTC" : "Binance USDⓈ-M, Tageskerzen UTC" });
    } else out.push({ symbol: sym, change: null, basis: "tag", price: null, asOf: null, source: null });
  }
  return out;
}

/** Key levels of the live market (the fixed five and the own ones), the most important first. */
export function levelInput(view: KeyLevelsView | null): KeyLevelInput {
  if (!view || view.state !== "ok") return { available: false, reason: "Der Live-Markt läuft nicht, die Marken sind nicht bewertet", rows: [], planHeadline: null };
  const rows: LevelRow[] = view.entries
    .filter((e) => e.live && e.level.enabled)
    .sort((a, b) => a.level.priority - b.level.priority)
    .slice(0, MAX_LEVELS)
    .map((e) => ({ name: e.level.name, symbol: e.level.symbol, price: e.level.price, tf: e.level.tf, status: e.evaluation.status, reason: e.evaluation.reason, asOf: e.evaluation.asOf }));
  return { available: true, rows, planHeadline: view.plan.headline };
}

/** The Zustellprotokoll as rows (newest first). */
export const alertRows = (log: readonly DeliveryRecord[]): AlertRow[] => log.map((r) => ({ at: r.at, title: r.title, outcome: OUTCOME_LABEL[r.outcome] }));

/** How the check-in of a day ended: answered, skipped, or still open (`DayNote.checkin` is a passthrough key). */
export function checkinStatusOf(raw: unknown): { state: CheckinInput["state"]; at: number | null } {
  if (!raw || typeof raw !== "object") return { state: "open", at: null };
  const c = raw as Record<string, unknown>;
  const at = typeof c.at === "string" ? Date.parse(c.at) : typeof c.firstAt === "string" ? Date.parse(c.firstAt) : NaN;
  const when = Number.isFinite(at) ? at : null;
  if (c.status === "skipped") return { state: "skipped", at: when };
  const answered = c.status === "done" || ["stress", "energy", "sleep", "focus", "sleepQuality"].some((k) => typeof c[k] === "number") || (Array.isArray(c.emotions) && c.emotions.length > 0);
  return answered ? { state: "done", at: when } : { state: "open", at: null };
}

/** The day's check-in and plan note. */
export function checkinInput(days: DayNotes, tz: string, now: number): CheckinInput | null {
  const key = dayKeyIn(now, tz);
  const d = days[key];
  const st = checkinStatusOf((d as { checkin?: unknown } | undefined)?.checkin);
  return { state: st.state, at: st.at, hasPlan: !!d?.plan?.trim() };
}

/** Everything `buildBriefing` needs, from the store values. */
export function briefingInputOf(s: BriefingStores): BriefingInput {
  return {
    now: s.now,
    tz: s.tz,
    own: ownEventsOfSettings(s.settings).items,
    markets: marketMoves(s),
    levels: levelInput(s.keyLevels),
    alerts: s.log ? alertRows(s.log) : null,
    checkin: checkinInput(s.days, s.tz, s.now),
  };
}
