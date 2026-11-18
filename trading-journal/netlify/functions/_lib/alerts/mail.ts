/**
 * The e-mail of an alert event: one event, one short mail, German or English by the user's language setting. Pure text builders – the
 * sending is `sendMail` of the e-mail alarm (Resend over `fetch`, idempotency key = the delivery id).
 *
 * Rules the mail keeps: what happened (event, market, the reading's own line, the time in the user's zone), "keine Beratung", how to switch
 * the channel off. No price target, no instruction – an alert points to a rule the user set up, nothing more.
 */
import { ALERT_EVENT_LABEL, ALERT_SOURCE_LABEL, type AlertEvent, type AlertLang, type AlertSourceKind } from "../../../../src/domain/alerts/types";
import { formatLocal } from "../alertWatch/clock";

const clean = (s: string): string => s.replace(/[\r\n\t]+/g, " ").trim();

export interface EventMailInput {
  lang: AlertLang;
  event: AlertEvent;
  market: string;
  source: AlertSourceKind;
  detail: string | null;
  /** ms */
  at: number;
  tz: string;
  appUrl: string | null;
}

export function buildEventMail(i: EventMailInput): { subject: string; text: string } {
  const label = ALERT_EVENT_LABEL[i.lang][i.event];
  const market = clean(i.market).slice(0, 60);
  const when = `${formatLocal(i.at, i.tz)} (${i.tz})`;
  if (i.lang === "en") {
    const lines = [
      `${label}: ${market}`,
      "",
      `Source: ${ALERT_SOURCE_LABEL[i.source]}`,
      ...(i.detail ? [`Reading: ${clean(i.detail)}`] : []),
      `Time: ${when}`,
      "",
      ...(i.appUrl ? [`To the app: ${i.appUrl}/#settings`, ""] : []),
      "No professional financial advice. This points to a rule you set up yourself – it is neither a recommendation nor an order; the app never sends orders.",
      "To stop: in the app under Settings › Alerts switch the e-mail channel off.",
    ];
    return { subject: `Alert: ${label} · ${market}`, text: lines.join("\n") };
  }
  const lines = [
    `${label}: ${market}`,
    "",
    `Quelle: ${ALERT_SOURCE_LABEL[i.source]}`,
    ...(i.detail ? [`Ablesung: ${clean(i.detail)}`] : []),
    `Zeit: ${when}`,
    "",
    ...(i.appUrl ? [`Zur App: ${i.appUrl}/#settings`, ""] : []),
    "Keine professionelle Finanzberatung. Das ist der Hinweis auf eine Regel, die du selbst eingestellt hast – keine Empfehlung und keine Order; die App sendet nie Orders.",
    "Abmelden: in der App unter Einstellungen › Alarme den Kanal E-Mail ausschalten.",
  ];
  return { subject: `Alarm: ${label} · ${market}`, text: lines.join("\n") };
}
