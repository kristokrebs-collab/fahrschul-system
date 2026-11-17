/**
 * Einstellungen › Alarme (C2): the view model – what the server answers (`/api/v1/alerts/prefs`, `/feed`), what the card makes of it, and the
 * German words of statuses and reasons. Pure: no React, no fetch. The plan is never decided here; the server's limits arrive with the answer.
 */
import { ALERT_CHANNELS, alertPrefsOf, channelOn, channelsOn, type AlertChannel, type AlertPrefs } from "@/domain/alerts/config";
import { reasonText, type DeliveryStatus } from "@/domain/alerts/delivery";
import { ALERT_EVENT_LABEL, ALERT_SOURCE_LABEL, isAlertEvent, isAlertSourceKind, type AlertEvent, type AlertSourceKind } from "@/domain/alerts/types";

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

export type PhoneStatus = "none" | "pending" | "verified" | "revoked";

export interface PrefsView {
  prefs: AlertPrefs;
  plan: string;
  limits: { alertChannels: number; phoneCallsPerMonth: number };
  tz: string;
  email: { configured: boolean; hasEmail: boolean; confirmed: boolean };
  phone: { configured: boolean; verifyConfigured: boolean; status: PhoneStatus; masked: string | null };
  lastRun: { at: number; ok: boolean; code: string | null } | null;
}

/** The answer of `GET/PUT /alerts/prefs`, checked; `null` when it is not this function's. */
export function parsePrefsView(raw: unknown): PrefsView | null {
  if (!isObj(raw) || !isObj(raw.limits) || !isObj(raw.email) || !isObj(raw.phone)) return null;
  const st = raw.phone.status;
  const lr = raw.lastRun;
  return {
    prefs: alertPrefsOf(raw.prefs),
    plan: typeof raw.plan === "string" ? raw.plan : "free",
    limits: { alertChannels: Number(raw.limits.alertChannels) || 0, phoneCallsPerMonth: Number(raw.limits.phoneCallsPerMonth) || 0 },
    tz: typeof raw.tz === "string" ? raw.tz : "Europe/Berlin",
    email: { configured: raw.email.configured === true, hasEmail: raw.email.hasEmail === true, confirmed: raw.email.confirmed === true },
    phone: { configured: raw.phone.configured === true, verifyConfigured: raw.phone.verifyConfigured === true, status: st === "pending" || st === "verified" || st === "revoked" ? st : "none", masked: typeof raw.phone.masked === "string" ? raw.phone.masked : null },
    lastRun: isObj(lr) && typeof lr.at === "number" ? { at: lr.at, ok: lr.ok === true, code: typeof lr.code === "string" ? lr.code : null } : null,
  };
}

// ------------------------------------------------------------------------------------------ channel gates

export type ChannelGate =
  | { state: "ok" }
  /** the plan does not have it: say what to do next */
  | { state: "locked"; message: string; next: { label: string; page: "preise" } }
  /** the server is not set up for it */
  | { state: "setup"; message: string }
  /** an account step is missing (the number is not confirmed, the address is not confirmed) */
  | { state: "connect"; message: string };

export const GATE_TEXT = {
  phoneLocked: "Anrufe gibt es ab Premium.",
  phoneSetup: "Das Telefon ist auf diesem Server nicht eingerichtet – Einrichtung nötig.",
  phoneVerifySetup: "Die Nummernprüfung ist auf diesem Server nicht eingerichtet – Einrichtung nötig.",
  phoneConnect: "Bestätige zuerst deine Nummer.",
  emailSetup: "Der E-Mail-Versand ist auf diesem Server nicht eingerichtet – Einrichtung nötig.",
  emailConnect: "Bestätige zuerst die E-Mail-Adresse deines Kontos.",
  browserDenied: "Der Browser blockiert Benachrichtigungen. Erlaube sie in den Seiteneinstellungen des Browsers.",
} as const;

export function channelGate(c: AlertChannel, v: PrefsView): ChannelGate {
  if (c === "browser") return { state: "ok" };
  if (c === "email") {
    if (!v.email.configured) return { state: "setup", message: GATE_TEXT.emailSetup };
    if (!v.email.hasEmail || !v.email.confirmed) return { state: "connect", message: GATE_TEXT.emailConnect };
    return { state: "ok" };
  }
  if (!(v.limits.phoneCallsPerMonth > 0)) return { state: "locked", message: GATE_TEXT.phoneLocked, next: { label: "Tarife ansehen", page: "preise" } };
  if (!v.phone.configured) return { state: "setup", message: GATE_TEXT.phoneSetup };
  if (!v.phone.verifyConfigured) return { state: "setup", message: GATE_TEXT.phoneVerifySetup };
  if (v.phone.status !== "verified") return { state: "connect", message: GATE_TEXT.phoneConnect };
  return { state: "ok" };
}

/** `true` when switching `c` on would exceed the plan's number of channels (it is off now, and the limit is reached by the others). */
export function channelLimitHit(draft: AlertPrefs, c: AlertChannel, limit: number): boolean {
  return !channelOn(draft, c) && channelsOn(draft).length >= limit;
}

export function channelLimitText(limit: number): string {
  return `Dein Tarif erlaubt ${limit} ${limit === 1 ? "Kanal" : "Kanäle"} gleichzeitig. Schalte zuerst einen anderen Kanal ganz aus, oder wechsle den Tarif.`;
}

/** Switches one event of one channel (immutably). */
export function withEvent(p: AlertPrefs, c: AlertChannel, e: AlertEvent, on: boolean): AlertPrefs {
  return { ...p, channels: { ...p.channels, [c]: { ...p.channels[c], [e]: on } } };
}

export const prefsEqual = (a: AlertPrefs, b: AlertPrefs): boolean => JSON.stringify(a) === JSON.stringify(b);

// ------------------------------------------------------------------------------------------ protocol

export interface FeedDelivery {
  id: string;
  channel: AlertChannel;
  status: DeliveryStatus;
  reason: string | null;
  attempts: number;
  at: string | null;
}

export interface FeedEvent {
  id: string;
  source: AlertSourceKind;
  market: string;
  event: AlertEvent;
  value: number | null;
  detail: string | null;
  suppressed: "cooldown" | null;
  at: string;
  deliveries: FeedDelivery[];
}

export interface FeedTest {
  id: string;
  kind: string;
  channel: AlertChannel;
  status: DeliveryStatus;
  reason: string | null;
  at: string | null;
}

export interface BrowserItem {
  deliveryId: string;
  event: AlertEvent;
  market: string;
  source: AlertSourceKind;
  detail: string | null;
  at: string;
}

export interface Feed {
  events: FeedEvent[];
  other: FeedTest[];
  browser: BrowserItem[];
}

const STATUSES: readonly string[] = ["queued", "sending", "ringing", "answered", "sent", "shown", "failed", "skipped", "dead"];
const isChannel = (v: unknown): v is AlertChannel => typeof v === "string" && (ALERT_CHANNELS as readonly string[]).includes(v);

function deliveryOf(d: unknown): FeedDelivery | null {
  if (!isObj(d) || typeof d.id !== "string" || !isChannel(d.channel) || typeof d.status !== "string" || !STATUSES.includes(d.status)) return null;
  return { id: d.id, channel: d.channel, status: d.status as DeliveryStatus, reason: typeof d.reason === "string" ? d.reason : null, attempts: typeof d.attempts === "number" ? d.attempts : 0, at: typeof d.at === "string" ? d.at : null };
}

/** The answer of `GET /alerts/feed`, checked row by row (a row that does not fit is left out, never guessed). */
export function parseFeed(raw: unknown): Feed | null {
  if (!isObj(raw) || !Array.isArray(raw.events)) return null;
  const events: FeedEvent[] = [];
  for (const e of raw.events) {
    if (!isObj(e) || typeof e.id !== "string" || !isAlertEvent(e.event) || !isAlertSourceKind(e.source) || typeof e.at !== "string") continue;
    events.push({
      id: e.id,
      source: e.source,
      market: typeof e.market === "string" ? e.market : "",
      event: e.event,
      value: typeof e.value === "number" ? e.value : null,
      detail: typeof e.detail === "string" ? e.detail : null,
      suppressed: e.suppressed === "cooldown" ? "cooldown" : null,
      at: e.at,
      deliveries: (Array.isArray(e.deliveries) ? e.deliveries : []).map(deliveryOf).filter((d): d is FeedDelivery => d !== null),
    });
  }
  const other: FeedTest[] = [];
  for (const t of Array.isArray(raw.other) ? raw.other : []) {
    const d = deliveryOf(t);
    if (d && isObj(t)) other.push({ id: d.id, kind: typeof t.kind === "string" ? t.kind : "test", channel: d.channel, status: d.status, reason: d.reason, at: d.at });
  }
  const browser: BrowserItem[] = [];
  for (const b of Array.isArray(raw.browser) ? raw.browser : []) {
    if (isObj(b) && typeof b.deliveryId === "string" && isAlertEvent(b.event) && isAlertSourceKind(b.source) && typeof b.at === "string") {
      browser.push({ deliveryId: b.deliveryId, event: b.event, market: typeof b.market === "string" ? b.market : "", source: b.source, detail: typeof b.detail === "string" ? b.detail : null, at: b.at });
    }
  }
  return { events, other, browser };
}

export const STATUS_LABEL: Readonly<Record<DeliveryStatus, string>> = {
  queued: "wartet",
  sending: "wird gesendet",
  ringing: "klingelt",
  answered: "angenommen",
  sent: "gesendet",
  shown: "angezeigt",
  failed: "fehlgeschlagen",
  skipped: "übersprungen",
  dead: "verworfen",
};

export type StatusTone = "win" | "loss" | "steel" | "mute";
export const STATUS_TONE: Readonly<Record<DeliveryStatus, StatusTone>> = { queued: "mute", sending: "steel", ringing: "steel", answered: "win", sent: "win", shown: "win", failed: "loss", skipped: "mute", dead: "loss" };

export const CHANNEL_LABEL: Readonly<Record<AlertChannel, string>> = { browser: "Browser", email: "E-Mail", phone: "Telefon" };

/** "Telefon: fehlgeschlagen – Besetzt" / "E-Mail: verworfen nach 5 Versuchen – Der Versanddienst antwortet nicht". */
export function deliveryLine(d: Pick<FeedDelivery, "channel" | "status" | "reason" | "attempts">): string {
  const head = `${CHANNEL_LABEL[d.channel]}: ${STATUS_LABEL[d.status]}${d.status === "dead" ? ` nach ${d.attempts} Versuchen` : ""}`;
  return d.reason ? `${head} – ${reasonText(d.reason)}` : head;
}

export interface ProtocolRow {
  id: string;
  at: string;
  title: string;
  sub: string;
  /** held back by the cooldown: no deliveries */
  note: string | null;
  deliveries: { id: string; channel: AlertChannel; status: DeliveryStatus; tone: StatusTone; text: string }[];
}

/** The rows of the Zustellprotokoll, newest first: events with their deliveries, the tests next to them in time. */
export function protocolRows(feed: Feed): ProtocolRow[] {
  const rows: ProtocolRow[] = feed.events.map((e) => ({
    id: e.id,
    at: e.at,
    title: `${ALERT_EVENT_LABEL.de[e.event]} · ${e.market}`,
    sub: `${ALERT_SOURCE_LABEL[e.source]}${e.detail ? ` · ${e.detail}` : ""}`,
    note: e.suppressed === "cooldown" ? "Zurückgehalten: dasselbe Ereignis kam kurz vorher schon an (Wiederholungssperre)." : e.deliveries.length === 0 ? "Kein Kanal wollte dieses Ereignis." : null,
    deliveries: e.deliveries.map((d) => ({ id: d.id, channel: d.channel, status: d.status, tone: STATUS_TONE[d.status], text: deliveryLine(d) })),
  }));
  for (const t of feed.other) {
    rows.push({
      id: t.id,
      at: t.at ?? "",
      title: t.kind === "test" ? `Test · ${CHANNEL_LABEL[t.channel]}` : `Sammelmail · ${CHANNEL_LABEL[t.channel]}`,
      sub: t.kind === "test" ? "Von dir ausgelöst" : "Schlüsselmarken-Alarm (Markt)",
      note: null,
      deliveries: [{ id: t.id, channel: t.channel, status: t.status, tone: STATUS_TONE[t.status], text: deliveryLine({ channel: t.channel, status: t.status, reason: t.reason, attempts: 0 }) }],
    });
  }
  return rows.sort((a, b) => (a.at < b.at ? 1 : a.at > b.at ? -1 : 0));
}

/** A deliveries counts as a dead letter when it ran out of retries. */
export const deadLetters = (feed: Feed): number => feed.events.reduce((n, e) => n + e.deliveries.filter((d) => d.status === "dead").length, 0);
