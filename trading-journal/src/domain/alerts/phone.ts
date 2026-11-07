/**
 * Telephone alerts (C2) – the pure part: the number (E.164, worldwide), the spoken text and the TwiML. No network, no clock.
 *
 * The call says ONE short thing: which event, which market, and that it is not advice. It never says what to do.
 */
import { ALERT_EVENT_LABEL, type AlertEvent, type AlertLang } from "./types";

// ------------------------------------------------------------------------------------------ number

/** Country calling codes that do not name a country or are premium / satellite / network services – never called. */
const BLOCKED_PREFIXES: readonly string[] = ["800", "808", "878", "881", "882", "883", "888", "979"];

export type PhoneProblem = "empty" | "format" | "too_short" | "too_long" | "blocked";

export type PhoneParse = { ok: true; e164: string } | { ok: false; problem: PhoneProblem };

/**
 * The number in E.164 (`+491701234567`): spaces, dots, dashes and brackets are dropped, `00` becomes `+`. A number WITHOUT a
 * country code is refused (we cannot know the country, and a guess would call a stranger). 7 to 15 digits, the country code does
 * not start with 0, and the non-geographic / premium country codes are refused. Whether the number exists is for the verification.
 */
export function parsePhone(input: string): PhoneParse {
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
  return { ok: true, e164: `+${digits}` };
}

export const isE164 = (s: string): boolean => /^\+[1-9]\d{6,14}$/.test(s);

export const PHONE_PROBLEM_TEXT: Readonly<Record<PhoneProblem, string>> = {
  empty: "Bitte gib eine Telefonnummer ein.",
  format: "Das ist keine gültige Telefonnummer. Schreibe sie mit Ländervorwahl, zum Beispiel +49 170 1234567.",
  too_short: "Die Nummer ist zu kurz. Schreibe sie mit Ländervorwahl, zum Beispiel +49 170 1234567.",
  too_long: "Die Nummer ist zu lang (höchstens 15 Ziffern mit Ländervorwahl).",
  blocked: "Diese Vorwahl ist für Anrufe nicht möglich.",
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
