/**
 * Morgenbriefing "Heute wichtig" (F43, after the skill `morning-note`): ONE page of what the app itself knows for today –
 * the appointments of the day, the movement of the watchlist and the market, the state of the key levels and alarms, the
 * open points of the check-in. Every line carries its source and its time; what is not there is said as "keine Daten".
 * Nothing is estimated, no news is invented, no trade is suggested – a briefing is a reading aid, not advice
 * (the page and the assistant add "Keine professionelle Finanzberatung.").
 *
 * Pure: the caller hands in what the stores hold (the page and the assistant read the same stores) and the clock.
 */
import { eventsBetween } from "./calendar";
import { KIND_LABEL, type CalendarEvent, type OwnEvent } from "./types";
import { formatClock, wallToUtc, dayKeyIn, addDays } from "./zone";
import { n0, price as fmtPrice, signed } from "@/lib/format";

export const NO_DATA = "keine Daten";

/** One market or watchlist symbol with its latest move. */
export interface MarketMove {
  symbol: string;
  /** fraction (0.023 = +2,3 %), `null` = no value */
  change: number | null;
  /** what the change spans: the rolling 24 h of the live feed, or the last closed day (UTC) */
  basis: "24h" | "tag";
  price: number | null;
  /** ms the value refers to (exchange time / close of the day), `null` = unknown */
  asOf: number | null;
  source: string | null;
}

export interface LevelRow {
  name: string;
  symbol: string;
  price: number;
  tf: string;
  status: "waiting" | "provisional" | "confirmed" | "invalidated" | "unknown";
  reason: string;
  asOf: number | null;
}

export interface KeyLevelInput {
  /** the live market runs and the levels were evaluated */
  available: boolean;
  /** why not (German), when `available` is false */
  reason?: string | null;
  rows: readonly LevelRow[];
  /** headline of the day plan ("Abwarten – …"), `null` = none */
  planHeadline: string | null;
}

export interface AlertRow {
  at: number;
  title: string;
  /** "gesendet" / "unterdrückt – Dublette" … */
  outcome: string;
}

export interface CheckinInput {
  state: "done" | "skipped" | "open";
  /** ms the answers were saved */
  at: number | null;
  /** the day note has a plan text */
  hasPlan: boolean;
}

export interface BriefingInput {
  now: number;
  tz: string;
  own: readonly OwnEvent[];
  markets: readonly MarketMove[];
  levels: KeyLevelInput;
  /** the Zustellprotokoll (newest first); `null` = it is not available */
  alerts: readonly AlertRow[] | null;
  checkin: CheckinInput | null;
}

export type BriefingTone = "win" | "loss" | "warn" | "mute" | "fg";

export interface BriefingLine {
  text: string;
  /** where the line comes from, always filled */
  source: string;
  /** ms the line's data refers to; `null` = no time known ("keine Daten") */
  at: number | null;
  tone: BriefingTone;
  /** the line says that data is missing */
  missing?: boolean;
}

export type BriefingSectionId = "overview" | "events" | "markets" | "levels" | "alerts" | "checkin" | "watch";

export interface BriefingSection {
  id: BriefingSectionId;
  title: string;
  lines: BriefingLine[];
}

export interface Briefing {
  generatedAt: number;
  tz: string;
  /** the calendar day of `tz` the briefing is for */
  day: string;
  sections: BriefingSection[];
}

/** |change| from which a market counts as "moving" (like the morning note: 2 %). */
export const MOVE_THRESHOLD = 0.02;
const MAX_MARKETS = 8;

const line = (text: string, source: string, at: number | null, tone: BriefingTone = "fg", missing = false): BriefingLine => ({ text, source, at, tone, ...(missing ? { missing } : {}) });
const missingLine = (what: string, source: string): BriefingLine => line(`${what}: ${NO_DATA}.`, source, null, "mute", true);

const STATUS_WORD: Readonly<Record<LevelRow["status"], string>> = {
  waiting: "wartet",
  provisional: "vorläufig (Kerze läuft)",
  confirmed: "bestätigt",
  invalidated: "ungültig",
  unknown: NO_DATA,
};

const dayWindow = (day: string, tz: string): [number, number] => {
  const at = (k: string): number => wallToUtc({ y: +k.slice(0, 4), m: +k.slice(5, 7), d: +k.slice(8, 10), h: 0, min: 0 }, tz);
  return [at(day), at(addDays(day, 1))];
};

/** The appointments of the day `day` (a `YYYY-MM-DD` of `tz`), funding folded into one line. */
function eventLines(day: string, tz: string, own: readonly OwnEvent[], now: number): BriefingLine[] {
  const [from, to] = dayWindow(day, tz);
  const list = eventsBetween({ from, to, own });
  const lines: BriefingLine[] = [];
  const funding = list.filter((e) => e.kind === "funding");
  const rest = list.filter((e) => e.kind !== "funding" && e.kind !== "weekend");
  const weekend = list.find((e) => e.kind === "weekend");
  for (const e of rest) {
    const when = e.allDay ? "ganztägig" : `${formatClock(e.at, tz)} Uhr`;
    const tone: BriefingTone = e.importance === "hoch" ? "warn" : "fg";
    lines.push(line(`${when} · ${e.title}${e.detail ? ` (${e.detail})` : ""}`, e.source.label, e.at, e.at < now && !e.allDay ? "mute" : tone));
  }
  if (funding.length) lines.push(line(`Funding-Abrechnungen um ${funding.map((e) => formatClock(e.at, tz)).join(", ")} Uhr`, funding[0]!.source.label, funding[0]!.at, "mute"));
  if (weekend) {
    // the weekend is Saturday 00:00 to Monday 00:00 UTC, the day is a day of `tz`: say when it begins or ends inside the day
    // instead of calling a whole Monday "Wochenende" because its first hour (UTC) still belongs to it
    const end = weekend.end ?? weekend.at;
    if (weekend.at > from) lines.push(line(`Wochenende (UTC) beginnt um ${formatClock(weekend.at, tz)} Uhr: danach sind die US-Börsen geschlossen, Krypto handelt durchgehend`, weekend.source.label, weekend.at, "mute"));
    else if (end < to) {
      if (end > now) lines.push(line(`Wochenende (UTC) endet um ${formatClock(end, tz)} Uhr: bis dahin sind die US-Börsen geschlossen`, weekend.source.label, end, "mute"));
    } else lines.push(line("Wochenende (UTC): die US-Börsen sind geschlossen, Krypto handelt durchgehend", weekend.source.label, weekend.at, "mute"));
  }
  if (!lines.length) lines.push(line("Für heute sind keine Termine eingetragen oder berechnet.", "Ereigniskalender", from, "mute"));
  return lines;
}

const pctText = (c: number): string => `${signed(c * 100, 1)} %`;

function marketLines(markets: readonly MarketMove[]): BriefingLine[] {
  if (!markets.length) return [missingLine("Live-Markt und Watchlist", "Marktdaten")];
  const withValue = markets.filter((m) => m.change != null);
  const sorted = [...withValue].sort((a, b) => Math.abs(b.change!) - Math.abs(a.change!));
  const shown = sorted.slice(0, MAX_MARKETS);
  const out: BriefingLine[] = shown.map((m) => {
    const moving = Math.abs(m.change!) >= MOVE_THRESHOLD;
    const basis = m.basis === "24h" ? "24 h" : "letzter Tagesschluss";
    return line(`${m.symbol}: ${pctText(m.change!)} (${basis})${m.price != null ? ` · ${fmtPrice(m.price)}` : ""}${moving ? " · bewegt sich" : ""}`, m.source ?? "Marktdaten", m.asOf, moving ? (m.change! > 0 ? "win" : "loss") : "fg");
  });
  if (sorted.length > shown.length) out.push(line(`${sorted.length - shown.length} weitere Märkte mit kleinerer Bewegung.`, "Marktdaten", null, "mute"));
  // the symbols without a value stand in ONE line, not one line each
  const none = markets.filter((x) => x.change == null).map((x) => x.symbol);
  if (none.length) out.push(line(`${none.join(", ")}: ${NO_DATA}`, "Marktdaten", null, "mute", true));
  return out;
}

function levelLines(l: KeyLevelInput): BriefingLine[] {
  if (!l.available) return [line(`Marken: ${NO_DATA}${l.reason ? ` (${l.reason})` : ""}.`, "Schlüsselmarken", null, "mute", true)];
  const out: BriefingLine[] = [];
  if (l.planHeadline) out.push(line(`Tagesplan: ${l.planHeadline}`, "Tagesplan (aus den Schlüsselmarken)", null, "fg"));
  if (!l.rows.length) out.push(line("Keine Schlüsselmarke gesetzt.", "Schlüsselmarken", null, "mute"));
  for (const r of l.rows) {
    const tone: BriefingTone = r.status === "confirmed" ? "win" : r.status === "provisional" ? "warn" : r.status === "invalidated" ? "loss" : "mute";
    out.push(line(`${r.name} ${fmtPrice(r.price)} (${r.symbol}, ${r.tf}): ${STATUS_WORD[r.status]}${r.status === "unknown" ? "" : ` – ${r.reason}`}`, "Schlüsselmarken", r.asOf, tone, r.status === "unknown"));
  }
  return out;
}

function alertLines(alerts: readonly AlertRow[] | null, day: string, tz: string): BriefingLine[] {
  if (!alerts) return [missingLine("Zustellprotokoll", "Zustellprotokoll")];
  const today = alerts.filter((a) => dayKeyIn(a.at, tz) === day);
  if (!today.length) return [line("Heute noch keine Alarm-Meldung im Zustellprotokoll (es hält die letzten 200 Zeilen und läuft nur, solange die App offen ist).", "Zustellprotokoll", null, "mute")];
  return today.slice(0, 5).map((a) => line(`${formatClock(a.at, tz)} Uhr · ${a.title} (${a.outcome})`, "Zustellprotokoll", a.at, "fg"));
}

function checkinLines(c: CheckinInput | null, tz: string): BriefingLine[] {
  if (!c) return [missingLine("Tagesjournal", "Tagesjournal")];
  const out: BriefingLine[] = [];
  if (c.state === "done") out.push(line(`Check-in erledigt${c.at != null ? ` um ${formatClock(c.at, tz)} Uhr` : ""}.`, "Tagesjournal", c.at, "win"));
  else if (c.state === "skipped") out.push(line("Check-in heute übersprungen.", "Tagesjournal", c.at, "mute"));
  else out.push(line("Check-in offen: noch nicht beantwortet.", "Tagesjournal", null, "warn"));
  out.push(c.hasPlan ? line("Plan für den Tag steht in der Tagesnotiz.", "Tagesjournal", null, "fg") : line("Plan für den Tag: noch leer (Tagesnotiz).", "Tagesjournal", null, "warn"));
  return out;
}

/** What deserves a look today – only from the lines above, no new claims (at most three). */
function watchLines(input: BriefingInput, events: readonly CalendarEvent[]): BriefingLine[] {
  const out: BriefingLine[] = [];
  for (const e of events.filter((x) => x.importance === "hoch" && x.kind !== "weekend")) {
    out.push(line(`${KIND_LABEL[e.kind]} heute: ${e.title}${e.allDay ? "" : ` um ${formatClock(e.at, input.tz)} Uhr`}.`, e.source.label, e.at, "warn"));
  }
  for (const r of input.levels.rows.filter((x) => x.status === "provisional" || x.status === "invalidated")) {
    out.push(line(`${r.name} ${fmtPrice(r.price)}: ${STATUS_WORD[r.status]}.`, "Schlüsselmarken", r.asOf, r.status === "invalidated" ? "loss" : "warn"));
  }
  const moving = input.markets.filter((m) => m.change != null && Math.abs(m.change) >= MOVE_THRESHOLD);
  if (moving.length) out.push(line(`${moving.length} von ${input.markets.length} Märkten bewegen sich um mindestens 2 %.`, "Marktdaten", null, "warn"));
  if (!out.length) return [line("Aus den vorhandenen Daten ergibt sich nichts, worauf heute besonders zu achten wäre.", "Ereigniskalender, Schlüsselmarken, Marktdaten", null, "mute")];
  return out.slice(0, 3);
}

/** The briefing for the day of `input.now` in `input.tz`. */
export function buildBriefing(input: BriefingInput): Briefing {
  const day = dayKeyIn(input.now, input.tz);
  const [from, to] = dayWindow(day, input.tz);
  const dayEvents = eventsBetween({ from, to, own: input.own });
  const evLines = eventLines(day, input.tz, input.own, input.now);
  const important = dayEvents.filter((e) => e.importance === "hoch" && e.kind !== "weekend").length;
  const counted = dayEvents.filter((e) => e.kind !== "funding" && e.kind !== "weekend").length;
  const moving = input.markets.filter((m) => m.change != null && Math.abs(m.change) >= MOVE_THRESHOLD).length;
  const known = input.markets.filter((m) => m.change != null).length;
  const overview: BriefingLine[] = [
    line(`Heute ${counted === 0 ? "stehen keine Termine außer dem Funding an" : counted === 1 ? "steht 1 Termin an" : `stehen ${n0(counted)} Termine an`}${important ? `, davon ${n0(important)} mit hoher Wichtigkeit` : ""}.`, "Ereigniskalender", from, "fg"),
    known
      ? line(`${n0(moving)} von ${n0(known)} Märkten mit Daten bewegen sich um mindestens 2 %.`, "Marktdaten", null, "fg")
      : missingLine("Bewegung der Märkte", "Marktdaten"),
  ];
  return {
    generatedAt: input.now,
    tz: input.tz,
    day,
    sections: [
      { id: "overview", title: "Überblick", lines: overview },
      { id: "events", title: "Termine heute", lines: evLines },
      { id: "markets", title: "Märkte & Watchlist", lines: marketLines(input.markets) },
      { id: "levels", title: "Schlüsselmarken", lines: levelLines(input.levels) },
      { id: "alerts", title: "Alarme", lines: alertLines(input.alerts, day, input.tz) },
      { id: "checkin", title: "Check-in", lines: checkinLines(input.checkin, input.tz) },
      { id: "watch", title: "Worauf achten", lines: watchLines(input, dayEvents) },
    ],
  };
}

/** The briefing as plain text (copy), every line with its full source. */
export function briefingText(b: Briefing): string {
  return b.sections.map((s) => `${s.title}\n${s.lines.map((l) => `– ${l.text} [${l.source}]`).join("\n")}`).join("\n\n");
}

/** "NYSE – Handelszeiten und Feiertage" → "NYSE": the short name of a source, for places with little room. */
export const shortSource = (source: string): string => source.split(/ – | \(|, /)[0]!.trim();

/**
 * The briefing as a few sentences for a chat answer: every line keeps its source and time in brackets, a section shows at most
 * `max` lines (the rest is counted). The full, dated version is the card „Heute wichtig“.
 */
export function briefingParagraph(b: Briefing, max = 4): string {
  const part = (l: BriefingLine): string => `${l.text.replace(/\.$/, "")} [${shortSource(l.source)}${l.at != null ? ` ${formatClock(l.at, b.tz)}` : ""}]`;
  return b.sections
    .map((s) => {
      const shown = s.lines.slice(0, max).map(part);
      const more = s.lines.length > max ? `; … (${s.lines.length - max} weitere)` : "";
      return `${s.title}: ${shown.join("; ")}${more}.`;
    })
    .join(" ");
}
