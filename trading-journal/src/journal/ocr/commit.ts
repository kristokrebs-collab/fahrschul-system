/**
 * Candidates → journal trades, written in ONE step with an undo (the preview's „Alle N Trades eintragen“). The mapping
 * is the import's own `toDraft` (what the editor would be pre-filled with); this file adds what a direct write needs:
 * the record's required fields (the editor's own rules), the notes about what was read vs derived vs assumed, the id,
 * the derived `pnl` / `r`, and the save / undo through the journal store. Pictures are never stored.
 */
import { computePnlR } from "@/domain/derive";
import type { AccountId, Trade } from "@/domain/types";
import { newTradeId } from "@/lib/ids";
import type { Candidate } from "@/journal/extract/candidate";
import { IMPORT_TAG, toDraft } from "@/journal/extract/draft";
import { useJournal } from "@/store/journalStore";
import type { ReadRecord } from "./records";

export interface CommitContext {
  account: AccountId;
  now: Date;
  /** The zone sentence of the preview („angenommen: Europe/Berlin“). */
  zoneText: string;
  /** „Positionshistorie“ … */
  viewLabel: string;
}

const money = (v: number): string => new Intl.NumberFormat("de-DE", { maximumFractionDigits: 4 }).format(v);

/** Lines for the trade's notes: where it came from and what is derived / assumed – never presented as read. */
export function importNotes(c: Candidate, recs: readonly ReadRecord[], ctx: Pick<CommitContext, "zoneText" | "viewLabel">, currency: string): string[] {
  const lines = [`Aus Screenshot übernommen (${ctx.viewLabel}, Texterkennung auf dem Gerät) – Lesefehler sind möglich.`];
  lines.push(`Zeiten: ${ctx.zoneText}`);
  const r = recs[0];
  if (r?.marginMode) lines.push(`Margin: ${r.marginMode === "isolated" ? "isoliert" : "cross"}.`);
  if (r?.derivedFees != null && c.fees.value != null) lines.push(`Gebühren ≈ ${money(c.fees.value)} ${currency} (inkl. Funding) aus Preisen × Menge − Ergebnis abgeleitet, nicht im Screenshot gelesen.`);
  if (r?.maxQty != null && r.nums.qty?.value != null && r.nums.qty.value < r.maxQty * 0.999) lines.push(`Nur ein Teil der Position: ${r.nums.qty.text} von ${money(r.maxQty)} geschlossen.`);
  if (recs.some((x) => x.side.derived)) lines.push("Die Richtung wurde aus Preisen und Ergebnis abgeleitet, nicht gelesen.");
  if (recs.some((x) => x.nums.pnl?.derived)) lines.push("Das Minus des Ergebnisses wurde aus der roten Farbe ergänzt, nicht gelesen.");
  return [...new Set(lines)];
}

export type BuildResult = { ok: true; trade: Trade } | { ok: false; problem: string };

/** The journal trade of one candidate, or why it cannot be written yet. */
export function buildTrade(c: Candidate, recs: readonly ReadRecord[], ctx: CommitContext, currency: string): BuildResult {
  const d = toDraft(c, []);
  if (!d.pair) return { ok: false, problem: "Markt fehlt" };
  if (!d.side) return { ok: false, problem: "Richtung fehlt" };
  if (!d.date) return { ok: false, problem: "Einstiegszeit fehlt" };
  if (!(d.entry != null && d.entry > 0)) return { ok: false, problem: "Einstieg fehlt" };
  const closed = d.status !== "open";
  if (closed && d.pnlManual == null && !(d.exit != null && d.exit > 0 && ((d.size ?? 0) > 0 || (d.qty ?? 0) > 0))) return { ok: false, problem: d.exit == null ? "Ausstieg fehlt" : "Menge fehlt" };
  if (closed && !(d.qty != null && d.qty > 0) && !(d.size != null && d.size > 0)) return { ok: false, problem: "Menge fehlt" };
  const iso = ctx.now.toISOString();
  // `updatedAt` is when the TRADE last changed (its exit, else its entry), not when it was typed in: a history import is
  // not a "just saved" trade, so the live watchers (coach, risk guard, post-trade review) leave it alone
  const lastEvent = Date.parse(d.exitDate ?? d.date);
  const updatedAt = Number.isFinite(lastEvent) && lastEvent < ctx.now.getTime() ? new Date(lastEvent).toISOString() : iso;
  const notes = [...importNotes(c, recs, ctx, currency), ...(d.notes ? [d.notes] : [])].join("\n");
  const marginMode = recs[0]?.marginMode ?? undefined;
  const base: Trade = {
    id: newTradeId(),
    account: ctx.account,
    side: d.side,
    status: closed ? "closed" : "open",
    date: d.date,
    pair: d.pair,
    timeframe: "",
    entry: d.entry,
    stop: d.stop ?? null,
    target: d.target ?? null,
    exit: closed ? (d.exit ?? null) : null,
    size: d.size ?? null,
    leverage: d.leverage ?? null,
    fees: d.fees ?? null,
    pnlManual: closed ? (d.pnlManual ?? null) : null,
    setups: [],
    checks: {},
    conviction: null,
    followedPlan: null,
    emotion: "",
    reason: "",
    notes,
    chart: "",
    pnl: null,
    r: null,
    createdAt: iso,
    updatedAt,
    mistakes: [],
    tags: [IMPORT_TAG],
    ...(d.exitDate ? { exitDate: d.exitDate } : {}),
    ...(d.market ? { market: d.market } : {}),
    ...(d.exchange ? { exchange: d.exchange } : {}),
    ...(d.qty != null ? { qty: d.qty } : {}),
    ...(d.fundingFees != null ? { fundingFees: d.fundingFees } : {}),
    ...(d.fills ? { fills: d.fills } : {}),
    ...(d.plannedEntry != null ? { plannedEntry: d.plannedEntry } : {}),
    ...(d.targets ? { targets: d.targets } : {}),
    ...(marginMode ? { marginMode } : {}),
  };
  const { pnl, r } = computePnlR(base);
  return { ok: true, trade: { ...base, pnl, r } };
}

export interface CommitResult {
  ids: string[];
  failed: number;
}

/** Writes the trades one after the other (every store write is atomic); a failing write stops there – what is saved stays. */
export async function commitTrades(trades: readonly Trade[]): Promise<CommitResult> {
  const ids: string[] = [];
  let failed = 0;
  for (const t of trades) {
    try {
      await useJournal.getState().saveTrade(t);
      ids.push(t.id);
    } catch {
      failed = trades.length - ids.length;
      break;
    }
  }
  return { ids, failed };
}

/** Removes the trades a commit wrote (ids that are gone already are skipped). Returns how many were removed. */
export async function undoCommit(ids: readonly string[]): Promise<number> {
  let n = 0;
  for (const id of ids) {
    if (!useJournal.getState().trades.some((t) => t.id === id)) continue;
    try {
      await useJournal.getState().deleteTrade(id);
      n += 1;
    } catch {
      /* the next one may still go */
    }
  }
  return n;
}
