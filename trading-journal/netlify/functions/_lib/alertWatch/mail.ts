/**
 * The mail of the e-mail alarm: text builders (pure, German, short) and the Resend HTTP call.
 *
 * Rules the mail keeps:
 *   - ONE mail for everything that waits (a summary, not a flood); at most `MAIL_ITEMS_MAX` fires are listed, the rest is
 *     counted; what was folded in (cooldown) or dropped (older than 24 h) is said in one line;
 *   - every fire carries symbol, rule, level price, the time and price when it fired, and the price NOW with its source
 *     and time ("Stand") – a missing number reads "keine Daten", it is never filled in;
 *   - "Keine professionelle Finanzberatung.", a link to the app and how to switch the alarm off;
 *   - the recipient is the account's own address; it never appears in a log, an error or a result (only codes do).
 * The key (`RESEND_API_KEY`) and the sender (`ALERT_FROM`) are server env – without both nothing is sent and the app
 * reports "Einrichtung nötig".
 */
import { price as fmtPrice } from "../../../../src/lib/format";
import { STAGE_LABEL } from "../../../../src/domain/keylevels/alerts";
import { MAIL_ITEMS_MAX, type OutboxItem, type ServerAlertsCfg } from "../../../../src/domain/keylevels/serverAlerts";
import { tfLabel } from "../../../../src/domain/keylevels/timeframes";
import { envOptional } from "../env";
import { formatLocal } from "./clock";

const RESEND_URL = "https://api.resend.com/emails";
const clean = (s: string): string => s.replace(/[\r\n\t]+/g, " ").trim();

/** Site origin without a trailing slash (`SITE_ORIGIN`), or `null`: the link in the mail and the base of the proxy fallback. */
export function appOrigin(): string | null {
  const o = envOptional("SITE_ORIGIN")?.trim().replace(/\/+$/, "");
  return o && /^https?:\/\/[^/\s]+$/i.test(o) ? o : null;
}

export interface MailContent {
  subject: string;
  text: string;
}

export interface AlertMailInput {
  items: readonly OutboxItem[];
  notes: ServerAlertsCfg["notes"];
  /** fires that waited longer than 24 h and are not mailed any more */
  expired: number;
  tz: string;
  now: number;
  /** prices of this run (symbol → last price) */
  prices: ReadonlyMap<string, number>;
  /** "Binance USDⓈ-M Futures" or the proxy – where the prices come from */
  sourceLabel: string;
  /** `https://site` or `null` */
  appUrl: string | null;
  maxPerDay: number;
  /** mails of today INCLUDING this one */
  sentToday: number;
}

const FOOTER = [
  "Keine professionelle Finanzberatung. Das ist der Hinweis auf eine Regel, die du selbst festgelegt hast – keine Empfehlung und keine Order; die App sendet nie Orders.",
  "Abmelden: in der App unter Markt › Alarme & Zustellprotokoll › „E-Mail-Alarm bei geschlossener App“ ausschalten.",
];

/** Subject and body of the alert mail. */
export function buildAlertMail(i: AlertMailInput): MailContent {
  const items = [...i.items].sort((a, b) => a.at - b.at);
  const shown = items.slice(-MAIL_ITEMS_MAX);
  const older = items.length - shown.length;
  const first = items[items.length - 1]!;
  const head = (it: OutboxItem): string => `${STAGE_LABEL[it.stage]} · ${clean(it.name)} · ${it.symbol} ${tfLabel(it.tf)}`;
  const subject = items.length === 1 ? `Schlüsselmarke: ${head(first)}` : `${items.length} Alarme deiner Schlüsselmarken (${[...new Set(items.map((x) => x.symbol))].slice(0, 3).join(", ")})`;
  const now = (sym: string): string => {
    const p = i.prices.get(sym);
    return p == null ? "keine Daten" : fmtPrice(p);
  };
  const lines: string[] = [items.length === 1 ? "Eine deiner Schlüsselmarken hat ausgelöst." : `${items.length} deiner Schlüsselmarken haben ausgelöst.`, ""];
  shown.forEach((it, n) => {
    lines.push(`${shown.length > 1 ? `${n + 1}) ` : ""}${head(it)}`);
    lines.push(`   Regel: ${it.rule}`);
    lines.push(`   Ausgelöst: ${formatLocal(it.at, i.tz)} bei ${it.last == null ? "keine Daten" : fmtPrice(it.last)} · Kurs jetzt: ${now(it.symbol)}`);
    if (it.detail) lines.push(`   Grund: ${clean(it.detail)}`);
    if (it.basis === "intrabar") lines.push("   Vorläufig: die laufende Kerze zählt noch nicht als Schluss.");
    lines.push("");
  });
  if (older > 0) lines.push(`… und ${older} ${older === 1 ? "weitere Auslösung" : "weitere Auslösungen"} davor.`, "");
  lines.push(`Stand: ${i.sourceLabel}, ${formatLocal(i.now, i.tz)} (${i.tz}).`);
  const notes: string[] = [];
  if (i.notes.suppressed > 0) notes.push(`${i.notes.suppressed} ${i.notes.suppressed === 1 ? "Auslösung wurde" : "Auslösungen wurden"} wegen der Wiederholungssperre nicht einzeln gemailt.`);
  if (i.notes.dropped + i.expired > 0) {
    const n = i.notes.dropped + i.expired;
    notes.push(`${n} ${n === 1 ? "ältere Auslösung wird" : "ältere Auslösungen werden"} nicht mehr gemailt (älter als 24 Stunden oder zu viele auf einmal).`);
  }
  notes.push(i.sentToday >= i.maxPerDay ? `Das war die letzte Mail für heute (Grenze ${i.maxPerDay} pro Tag) – weitere Auslösungen kommen gesammelt später.` : `Heute ${i.sentToday} von höchstens ${i.maxPerDay} Mails.`);
  lines.push(...notes, "");
  if (i.appUrl) lines.push(`Zur App: ${i.appUrl}/#markt`, "");
  lines.push(...FOOTER);
  return { subject, text: lines.join("\n") };
}

/** Subject and body of the test mail ("Testmail senden"). */
export function buildTestMail(i: { now: number; tz: string; appUrl: string | null }): MailContent {
  const lines = [
    "Das ist eine Testmail deines E-Mail-Alarms.",
    "",
    `Gesendet: ${formatLocal(i.now, i.tz)} (${i.tz}). Wenn du sie liest, kann der Server dich erreichen.`,
    "Echte Alarme kommen nur für Schlüsselmarken, bei denen du den Alarm eingeschaltet hast – sie werden gesammelt, mit Ruhezeiten und einer Obergrenze pro Tag.",
    "",
    ...(i.appUrl ? [`Zur App: ${i.appUrl}/#markt`, ""] : []),
    ...FOOTER,
  ];
  return { subject: "Testmail – E-Mail-Alarm", text: lines.join("\n") };
}

// ------------------------------------------------------------------------------------------ Resend

export interface MailConfig {
  apiKey: string;
  from: string;
}

/** `Name <a@b.c>` or `a@b.c`. */
const FROM = /^(?:[^<>\r\n]{1,80}\s<[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+>|[^<>\s@]+@[^<>\s@]+\.[^<>\s@]+)$/;

/** Key and sender from the server env, or `null` when one is missing / malformed (then nothing is sent). */
export function mailConfig(): MailConfig | null {
  const apiKey = envOptional("RESEND_API_KEY")?.trim();
  const from = envOptional("ALERT_FROM")?.trim();
  if (!apiKey || !from || !FROM.test(from)) return null;
  return { apiKey, from };
}

export type SendCode = "resend_auth" | "resend_invalid" | "resend_rate" | "resend_busy" | "resend_5xx" | "resend_network";
export type SendResult = { ok: true; id: string | null; duplicate?: boolean } | { ok: false; code: SendCode; status: number | null };

type FetchFn = (input: string, init?: RequestInit) => Promise<Response>;
let fetchOverride: FetchFn | null = null;
/** Tests: inject a fetch (`null` restores the real one). */
export function setMailFetchForTests(f: FetchFn | null): void {
  fetchOverride = f;
}

export function sendCodeOf(status: number): SendCode {
  if (status === 401 || status === 403) return "resend_auth";
  if (status === 429) return "resend_rate";
  if (status >= 500) return "resend_5xx";
  return "resend_invalid";
}

/**
 * Sends one mail through the Resend HTTP API. `idempotencyKey` makes a repeated request (a retry after a lost answer)
 * return the first result instead of mailing twice (Resend keeps keys for 24 h). Never throws; failures are codes.
 */
export async function sendMail(cfg: MailConfig, msg: { to: string; subject: string; text: string; idempotencyKey?: string }, fetchImpl?: FetchFn): Promise<SendResult> {
  const f = fetchImpl ?? fetchOverride ?? ((i, n) => fetch(i, n));
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8_000);
  try {
    const res = await f(RESEND_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: { authorization: `Bearer ${cfg.apiKey}`, "content-type": "application/json", ...(msg.idempotencyKey ? { "idempotency-key": msg.idempotencyKey } : {}) },
      body: JSON.stringify({ from: cfg.from, to: [msg.to], subject: msg.subject, text: msg.text }),
    });
    const body = (await res.json().catch(() => null)) as { id?: unknown; name?: unknown } | null;
    if (res.status === 409 && msg.idempotencyKey) {
      // the key was used before: with another payload (the retry of a mail that WAS accepted – the text carries the time) the
      // first request went through; while the first request is still running, try again later
      if (body?.name === "invalid_idempotent_request") return { ok: true, id: null, duplicate: true };
      if (body?.name === "concurrent_idempotent_requests") return { ok: false, code: "resend_busy", status: 409 };
    }
    if (!res.ok) return { ok: false, code: sendCodeOf(res.status), status: res.status };
    return { ok: true, id: typeof body?.id === "string" ? body.id : null };
  } catch {
    return { ok: false, code: "resend_network", status: null };
  } finally {
    clearTimeout(timer);
  }
}

/** The German reason of a failed send for the test mail (no secret in it). */
export const SEND_MESSAGE: Readonly<Record<SendCode, string>> = {
  resend_auth: "Der Versanddienst hat den Schlüssel oder die Absender-Domain abgelehnt.",
  resend_invalid: "Der Versanddienst hat die Mail abgelehnt (Absender oder Empfänger ungültig).",
  resend_rate: "Der Versanddienst ist gerade ausgelastet – bitte gleich noch einmal.",
  resend_busy: "Der Versanddienst bearbeitet gerade dieselbe Anfrage – bitte gleich noch einmal.",
  resend_5xx: "Der Versanddienst antwortet gerade nicht.",
  resend_network: "Der Versanddienst ist nicht erreichbar.",
};
