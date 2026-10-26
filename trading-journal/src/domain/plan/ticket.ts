/**
 * Ticket zum Kopieren (der Skill trader-broker, ausdrücklich OHNE Versand): der fertige Plan als Text und als CSV-Zeile –
 * Richtung, Einstieg, Stop, Ziel, Größe, maximaler Verlust, Quelle und Stand der Kerzen. Die App sendet nie eine Order und
 * hat keine Broker-Anbindung; das Ticket ist Text, den die Person selbst bei ihrer Börse eingibt, wenn sie es will.
 */
import { splitSymbol } from "@/market/symbol";
import type { Side } from "../types";
import { moneyText, num, pctText, priceText, qtyText } from "./format";
import type { ManageLine } from "./manage";
import type { Light } from "./risk";
import type { MarketKind } from "./sessions";
import { dateTimeIn, clockIn, zoneLabel } from "./time";

export type EntrySource = "signal" | "level" | "manual";

export interface TicketPlan {
  symbol: string;
  /** the market kind; absent = crypto (plans saved before stocks existed) */
  market?: MarketKind;
  side: Side;
  entry: number;
  stop: number;
  target: number | null;
  qty: number;
  notional: number;
  /** loss at the stop incl. fees and slippage */
  maxLoss: number;
  /** maxLoss ÷ capital */
  maxLossPct: number;
  rr: number | null;
  leverage: number;
  /** the "flat by" instant, `null` = none */
  flatByMs: number | null;
  light: Light;
  tick: number;
  lot: number;
  currency: string;
  /** zone of the session for the clock times in the text */
  tz: string;
  sessionLabel: string;
  entrySource: EntrySource;
  /** close of the signal candle */
  signalAt: number | null;
  stopLabel: string;
  targetLabel: string;
  /** where the candles came from ("Binance USDⓈ-M") */
  sourceLabel: string;
  /** candle length ("5 Minuten") */
  intervalLabel: string;
  /** end of the newest closed candle that was used */
  candlesUntil: number | null;
  /** when the candles were loaded */
  fetchedAt: number | null;
  /** how the trade is managed after the entry (F65): one line per rule, absent / empty = none planned */
  manage?: readonly ManageLine[] | null;
}

export interface Ticket {
  text: string;
  csv: string;
  /** label / value pairs, as shown on the card */
  rows: [string, string][];
}

const LIGHT_WORD: Record<Light, string> = { green: "Grün", amber: "Gelb", red: "Rot" };
export const MANAGE_NOTE = "Die Verwaltung ist eine Anweisung an dich selbst: neue Stops und Teilverkäufe setzt du, die App ändert keine Order.";
export const TICKET_NOTE = "Nur ein Plan zum Kopieren – die App sendet nichts an eine Börse und platziert keine Order. Keine professionelle Finanzberatung.";

/** The journal's pair notation of a market symbol ("BTCUSDT" → "BTC/USDT"); a stock stays its ticker. */
export function pairOf(symbol: string, market?: MarketKind): string {
  if (market === "stocks") return symbol;
  const s = splitSymbol(symbol);
  return s ? `${s.base}/${s.quote}` : symbol;
}

/** The base asset of a market symbol ("BTCUSDT" → "BTC"), else the symbol itself. */
export const baseOf = (symbol: string): string => splitSymbol(symbol)?.base ?? symbol;

/** What a quantity counts: the base asset of a crypto pair, whole shares ("Stück") for a stock. */
export const unitOf = (market: MarketKind | undefined, symbol: string): string => (market === "stocks" ? "Stück" : baseOf(symbol));

function csvCell(v: string): string {
  return /[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v;
}
const plain = (x: number, d = 8): string => String(Number(x.toFixed(d)));
const iso = (ms: number): string => new Date(ms).toISOString().replace(".000Z", "Z");

export function buildTicket(p: TicketPlan): Ticket {
  const P = (x: number): string => priceText(x, p.tick);
  const base = unitOf(p.market, p.symbol);
  const entryHow = p.entrySource === "signal" ? `Schlusskurs der Signal-Kerze${p.signalAt != null ? ` (${clockIn(p.signalAt, p.tz)} Uhr)` : ""}` : p.entrySource === "level" ? "geplant am Ausbruchsniveau, noch kein Signal" : "von dir eingegeben";
  const stand =
    p.candlesUntil != null || p.fetchedAt != null
      ? `${p.candlesUntil != null ? `Kerzen bis ${dateTimeIn(p.candlesUntil, p.tz)} Uhr (${zoneLabel(p.candlesUntil, p.tz)})` : "Kerzen: keine Daten"}${p.fetchedAt != null ? `, abgerufen ${dateTimeIn(p.fetchedAt, p.tz)} Uhr` : ""}`
      : "keine Daten";
  const rows: [string, string][] = [
    ["Symbol", p.symbol],
    ["Richtung", p.side === "long" ? "Long" : "Short"],
    ["Einstieg (Plan)", `${P(p.entry)} – ${entryHow}`],
    ["Stop", `${P(p.stop)} – ${p.stopLabel}`],
    ["Ziel", p.target != null ? `${P(p.target)} – ${p.targetLabel}` : "keins"],
    ["Größe", `${qtyText(p.qty, p.lot)} ${base} (Positionswert ${moneyText(p.notional)} ${p.currency}${p.leverage > 1 ? `, Hebel ${num(p.leverage, 0)}×` : ""})`],
    ["Max. Verlust am Stop", `${moneyText(p.maxLoss)} ${p.currency} (${pctText(p.maxLossPct, 2)} des Kontos, inkl. Gebühren und Slippage)`],
    ["Chance-Risiko", p.rr != null ? `${num(p.rr, 2)} : 1` : "–"],
    ...(p.manage ?? []).map((l): [string, string] => [`Verwaltung · ${l.label}`, l.text]),
    ["Flat by", p.flatByMs != null ? `${clockIn(p.flatByMs, p.tz)} Uhr (${zoneLabel(p.flatByMs, p.tz)})` : "nicht gesetzt"],
    ["Risiko-Check", LIGHT_WORD[p.light]],
    ["Sitzung", `${p.sessionLabel}, ${p.intervalLabel}`],
    ["Quelle", `${p.sourceLabel} · ${stand}`],
  ];
  const text = ["HANDELSPLAN – Ticket zum Kopieren", ...rows.map(([k, v]) => `${k}: ${v}`), ...(p.manage?.length ? [MANAGE_NOTE] : []), TICKET_NOTE].join("\n");
  const header = ["Symbol", "Richtung", "Einstieg", "Stop", "Ziel", "Menge", "Positionswert", "Max_Verlust", "Max_Verlust_Prozent", "Chance_Risiko", "Flat_by_UTC", "Ampel", "Quelle", "Kerzen_bis_UTC", "Abgerufen_UTC", ...(p.manage?.length ? ["Verwaltung"] : [])];
  const cells = [
    p.symbol,
    p.side,
    plain(p.entry),
    plain(p.stop),
    p.target != null ? plain(p.target) : "",
    plain(p.qty),
    plain(p.notional, 2),
    plain(p.maxLoss, 2),
    plain(p.maxLossPct * 100, 3),
    p.rr != null ? plain(p.rr, 3) : "",
    p.flatByMs != null ? iso(p.flatByMs) : "",
    LIGHT_WORD[p.light],
    p.sourceLabel,
    p.candlesUntil != null ? iso(p.candlesUntil) : "",
    p.fetchedAt != null ? iso(p.fetchedAt) : "",
    ...(p.manage?.length ? [p.manage.map((l) => `${l.label}: ${l.text}`).join(" | ")] : []),
  ];
  const csv = `${header.join(",")}\n${cells.map(csvCell).join(",")}`;
  return { text, csv, rows };
}
