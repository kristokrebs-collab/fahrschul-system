/**
 * Telephone alerts (C2) – the pure part: the number (E.164, worldwide), the spoken text and the TwiML. No network, no clock.
 *
 * The call says ONE short thing: which event, which market, and that it is not advice. It never says what to do.
 */
import { ALERT_EVENT_LABEL, type AlertEvent, type AlertLang } from "./types";

// ------------------------------------------------------------------------------------------ number

/** Country calling codes that do not name a country or are premium / satellite / network services – never called. */
const BLOCKED_PREFIXES: readonly string[] = ["800", "808", "878", "881", "882", "883", "888", "979"];

/**
 * Premium-rate, shared-cost and "personal number" ranges (country code + leading digits) that are never dialled or sent an SMS –
 * the revenue-share fraud (IRSF / SMS pumping) pattern: an attacker verifies a number whose carrier pays per message or minute (Runde 11,
 * Linse 1 #7 / Linse 3 #1). A SELECTION of the well-known ranges of the countries that are allowed by default, NOT a complete register:
 * the allowlist below (`DEFAULT_PHONE_COUNTRIES`) is the first line, Twilio's Geo Permissions and Fraud Guard the second (Betreiber-Aufgabe).
 */
const PREMIUM_PREFIXES: readonly string[] = [
  // Germany: 0900 premium, 0137 mass traffic, 0180 / 0181 shared cost, 0700 personal numbers, 0118 / 0116 services, 0190 (old premium)
  "49900", "49137", "49180", "49181", "49700", "49118", "49116", "49190",
  // Austria: 0900 / 0901 / 0930 / 0931 / 0939 premium, 0810 / 0820 / 0821 shared cost
  "43900", "43901", "43930", "43931", "43939", "43810", "43820", "43821",
  // Switzerland: 0900 / 0901 / 0906 premium, 0878 personal numbers
  "41900", "41901", "41906", "41878",
  // United Kingdom: 09xx premium, 084x / 087x special rate, 070 personal numbers
  "449", "4484", "4487", "4470",
  // France: 081x / 082x / 089x surcharged
  "3381", "3382", "3389",
  // Italy: 89x premium
  "39899", "39892", "39895", "39894",
  // Spain: 803 / 806 / 807 adult / premium, 905 television voting
  "34803", "34806", "34807", "34905",
  // Netherlands, Belgium: 090x premium
  "31900", "31906", "31909", "32900", "32901", "32902", "32903", "32904", "32905",
  // North America: 900 / 976 premium, and the Caribbean / Pacific area codes behind the +1 prefix that are the classic toll-fraud destinations
  "1900", "1976", "1242", "1246", "1264", "1268", "1284", "1340", "1345", "1441", "1473", "1649", "1664", "1670", "1671", "1684", "1721", "1758", "1767", "1784", "1787", "1809", "1829", "1849", "1868", "1869", "1876", "1939",
];

/**
 * Country calling codes the app calls and sends codes to BY DEFAULT: Germany, Austria, Switzerland, the rest of the EU / EEA, the United
 * Kingdom, the USA and Canada (the +1 area codes with fraud history are in `PREMIUM_PREFIXES`). The operator changes the list with
 * `PHONE_ALLOWED_COUNTRIES` (comma list of calling codes). Calling codes are prefix-free, so a prefix test is exact.
 */
export const DEFAULT_PHONE_COUNTRIES: readonly string[] = [
  "49", "43", "41", "31", "32", "33", "34", "351", "352", "353", "354", "356", "357", "358", "359", "36", "370", "371", "372", "385", "386", "39",
  "40", "420", "421", "423", "45", "46", "47", "48", "30", "44", "1",
];

/** The calling-code list of `PHONE_ALLOWED_COUNTRIES` (`"49, 43,+41"`): digits only, 1–3 long; junk entries are dropped; nothing usable → the default. */
export function parseCountryList(raw: string | undefined | null): readonly string[] {
  const list = (raw ?? "")
    .split(/[\s,;]+/)
    .map((x) => x.replace(/^\+/, "").replace(/^00/, ""))
    .filter((x) => /^[1-9]\d{0,2}$/.test(x));
  return list.length ? [...new Set(list)] : DEFAULT_PHONE_COUNTRIES;
}

export type PhoneProblem = "empty" | "format" | "too_short" | "too_long" | "blocked" | "premium" | "country";

export type PhoneParse = { ok: true; e164: string } | { ok: false; problem: PhoneProblem };

export interface ParsePhoneOptions {
  /** Only these country calling codes are accepted (the server passes `PHONE_ALLOWED_COUNTRIES`); without it every country passes (the browser's pre-check). */
  countries?: readonly string[];
}

/**
 * The number in E.164 (`+491701234567`): spaces, dots, dashes and brackets are dropped, `00` becomes `+`. A number WITHOUT a
 * country code is refused (we cannot know the country, and a guess would call a stranger). 7 to 15 digits, the country code does
 * not start with 0, and the non-geographic / premium country codes and the premium-rate ranges (`PREMIUM_PREFIXES`) are refused. With
 * `opts.countries` only those calling codes pass (the server's allowlist). Whether the number exists is for the verification.
 */
export function parsePhone(input: string, opts: ParsePhoneOptions = {}): PhoneParse {
  const raw = input.trim();
  if (!raw) return { ok: false, problem: "empty" };
  if (raw.length > 40 || /[^\d+\-().\s]/.test(raw)) return { ok: false, problem: "format" };
  let s = raw.replace(/[\s\-().]/g, "");
  if (s.startsWith("00")) s = `+${s.slice(2)}`;
  if (!/^\+\d+$/.test(s) || s.indexOf("+") !== s.lastIndexOf("+")) return { ok: false, problem: "format" };
  const digits = s.slice(1);
  if (digits.startsWith("0")) return { ok: false, problem: "format" };
  if (digits.length < 7) return { ok: false, problem: "too_short" };
  if (digits.length > 15) return { ok: false, problem: "too_long" };
  if (BLOCKED_PREFIXES.some((p) => digits.startsWith(p))) return { ok: false, problem: "blocked" };
  if (PREMIUM_PREFIXES.some((p) => digits.startsWith(p))) return { ok: false, problem: "premium" };
  if (opts.countries && !opts.countries.some((c) => digits.startsWith(c))) return { ok: false, problem: "country" };
  return { ok: true, e164: `+${digits}` };
}

export const isE164 = (s: string): boolean => /^\+[1-9]\d{6,14}$/.test(s);

export const PHONE_PROBLEM_TEXT: Readonly<Record<PhoneProblem, string>> = {
  empty: "Bitte gib eine Telefonnummer ein.",
  format: "Das ist keine gültige Telefonnummer. Schreibe sie mit Ländervorwahl, zum Beispiel +49 170 1234567.",
  too_short: "Die Nummer ist zu kurz. Schreibe sie mit Ländervorwahl, zum Beispiel +49 170 1234567.",
  too_long: "Die Nummer ist zu lang (höchstens 15 Ziffern mit Ländervorwahl).",
  blocked: "Diese Vorwahl ist für Anrufe nicht möglich.",
  premium: "Mehrwert- und Sondernummern sind für Anrufe nicht möglich. Trage deine normale Handynummer ein.",
  country: "Für dieses Land sind Anrufe auf diesem Server nicht freigeschaltet.",
};

/** `+49 ••• ••67`: the first two digits and the last two – enough to recognise the number, never enough to dial it. */
export function maskPhone(e164: string): string {
  if (!isE164(e164)) return "••••";
  return `${e164.slice(0, 3)} ••• ••${e164.slice(-2)}`;
}

// ------------------------------------------------------------------------------------------ consent

/** Version of the consent text below: stored with the consent; a changed text means a new version and a new consent. */
export const CONSENT_VERSION = "2026-11-v1";

/** What the person agrees to – shown next to the check box and stored (by version) with the consent. */
export const CONSENT_TEXT =
  "Ich bin einverstanden, dass die App mich unter dieser Nummer automatisch anruft, wenn ein Alarm auslöst, den ich eingeschaltet habe, und dass dafür eine Ansage mit dem Namen des Alarms abgespielt wird. Ich kann das jederzeit hier abschalten; dann wird die Nummer gelöscht. Der Anruf ist keine Beratung.";

// ------------------------------------------------------------------------------------------ spoken text

/** Letters, digits, space and a few marks, at most 40 characters – a market name is never read out as markup or a long text. */
export function spokenMarket(market: string): string {
  const s = market.normalize("NFC").replace(/[^\p{L}\p{N} .,&()/+-]/gu, " ").replace(/\s+/g, " ").trim();
  return s.slice(0, 40).trim() || "Markt";
}

export function alertCallText(lang: AlertLang, event: AlertEvent, market: string): string {
  const m = spokenMarket(market);
  return lang === "en" ? `Alert: ${ALERT_EVENT_LABEL.en[event]} for ${m}. This is not advice.` : `Alarm: ${ALERT_EVENT_LABEL.de[event]} bei ${m}. Das ist keine Beratung.`;
}

export function testCallText(lang: AlertLang): string {
  return lang === "en" ? "This is a test call from your alert settings. This is not advice." : "Das ist ein Testanruf aus deinen Alarm-Einstellungen. Das ist keine Beratung.";
}

export function xmlEscape(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&apos;");
}

/** The TwiML of a call: the text once, then once more after a pause (people pick up late), then hang up. */
export function buildTwiml(lang: AlertLang, text: string): string {
  const say = `<Say language="${lang === "en" ? "en-US" : "de-DE"}" voice="alice">${xmlEscape(text)}</Say>`;
  return `<?xml version="1.0" encoding="UTF-8"?><Response>${say}<Pause length="1"/>${say}</Response>`;
}
