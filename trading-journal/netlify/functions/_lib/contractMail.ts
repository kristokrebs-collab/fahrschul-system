/**
 * The mails of the cancel (§ 312k BGB) and withdrawal (§ 356a BGB) declarations – text builders only (pure, German). ENTWURF –
 * Prüfung durch Anwalt nötig. What the law asks of the confirmation: the CONTENT of the declaration, the DATE AND TIME of its
 * receipt and – for a cancellation – when the contract ends, on a durable medium (an e-mail is one). The mails never carry more
 * than that: no plan price, no offer, no marketing ("Angebot nur NACH der Bestätigung" is the app's rule, not an e-mail's).
 */
import { PLAN_CATALOG } from "../../../src/billing/plans";
import type { ContractKind } from "../../../src/billing/contract";
import type { BillingInterval, PlanId } from "../../../src/billing/types";

export interface ContractMailInput {
  kind: ContractKind;
  /** `verify`: the declaration was received, the link confirms it; `done`: it was executed; `none`: no contract found / the period is over. */
  step: "verify" | "done" | "late";
  receivedAt: Date;
  /** Execution time (done). */
  confirmedAt?: Date;
  /** When the contract ends (cancel: end of the paid period; withdraw: with the confirmation). */
  endsAt?: Date | null;
  plan?: PlanId | null;
  interval?: BillingInterval | null;
  /** Confirmation link (verify) – absolute. */
  link?: string | null;
  /** Name the consumer gave (withdrawal), echoed back as the content of the declaration. */
  name?: string | null;
  contract?: string | null;
  /** Operator name from `VITE_LEGAL_OPERATOR`, if set. */
  operator?: string | null;
}

export interface Mail {
  subject: string;
  text: string;
}

const KIND_WORD: Record<ContractKind, string> = { cancel: "Kündigung", withdraw: "Widerruf" };

/** `07.11.2026, 14:32:05 Uhr (Europe/Berlin)` – date AND time, the zone named. */
export function formatStamp(d: Date, tz = "Europe/Berlin"): string {
  const day = d.toLocaleDateString("de-DE", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" });
  const time = d.toLocaleTimeString("de-DE", { timeZone: tz, hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${day}, ${time} Uhr (${tz})`;
}

const dayOnly = (d: Date, tz = "Europe/Berlin"): string => d.toLocaleDateString("de-DE", { timeZone: tz, day: "2-digit", month: "2-digit", year: "numeric" });
const clean = (s: string): string => s.replace(/[\r\n\t]+/g, " ").trim().slice(0, 300);

export function contractLabel(plan?: PlanId | null, interval?: BillingInterval | null): string {
  if (!plan || plan === "free") return "Trade Journal";
  return `Trade Journal ${PLAN_CATALOG[plan].name}${interval ? (interval === "month" ? " (monatlich)" : " (jährlich)") : ""}`;
}

export function buildContractMail(i: ContractMailInput): Mail {
  const word = KIND_WORD[i.kind];
  const lines: string[] = [];
  const contract = contractLabel(i.plan, i.interval);
  if (i.step === "verify") {
    lines.push(
      `Wir haben deine ${word} für „${contract}“ am ${formatStamp(i.receivedAt)} erhalten.`,
      "",
      `Zur Sicherheit – damit niemand fremde Verträge beenden kann – bestätige sie bitte mit diesem Link (24 Stunden gültig):`,
      i.link ?? "",
      "",
      "Erst nach der Bestätigung wird die " + word + " ausgeführt. Du hast den Link nicht angefordert? Dann ignoriere diese Mail, es passiert nichts.",
    );
  } else if (i.step === "late") {
    lines.push(
      `Deine Erklärung (Widerruf) für „${contract}“ ist am ${formatStamp(i.receivedAt)} bei uns eingegangen.`,
      "",
      "Die Widerrufsfrist von 14 Tagen seit Vertragsschluss ist abgelaufen. Der Vertrag besteht weiter. Du kannst ihn jederzeit zum Ende der Laufzeit kündigen: in der App unter „Verträge hier kündigen“.",
    );
  } else {
    const at = i.confirmedAt ?? i.receivedAt;
    lines.push(`Bestätigung deiner ${word}`, "", `Inhalt: ${word} des Vertrags „${contract}“.`);
    if (i.kind === "withdraw") {
      if (i.name) lines.push(`Name: ${clean(i.name)}`);
      if (i.contract) lines.push(`Angabe zum Vertrag: ${clean(i.contract)}`);
    }
    lines.push(`Eingegangen: ${formatStamp(i.receivedAt)}`);
    if (i.confirmedAt) lines.push(`Bestätigt: ${formatStamp(at)}`);
    if (i.kind === "cancel") {
      lines.push(i.endsAt ? `Der Vertrag endet am ${dayOnly(i.endsAt)}. Bis dahin bleibt alles freigeschaltet, danach verlängert er sich nicht.` : "Der Vertrag endet zum Ende der laufenden Laufzeit und verlängert sich nicht.");
    } else {
      lines.push(
        "Der Vertrag ist mit dieser Bestätigung beendet, der bezahlte Tarif ist nicht mehr freigeschaltet.",
        "Bereits gezahlte Beträge erstatten wir innerhalb von 14 Tagen abzüglich des Werts der bis dahin erbrachten Leistung (§ 357a BGB). Den Betrag teilen wir dir getrennt mit.",
      );
    }
  }
  lines.push("", "Diese Mail ist deine Bestätigung auf einem dauerhaften Datenträger – bitte bewahre sie auf.");
  if (i.operator) lines.push(clean(i.operator));
  lines.push("", "Entwurf – Prüfung durch Anwalt nötig (Vorlage, keine Rechtsberatung).");
  const subject = i.step === "verify" ? `Bitte bestätige deine ${word}` : i.step === "late" ? "Widerrufsfrist abgelaufen" : `Bestätigung: ${word} eingegangen`;
  return { subject, text: lines.join("\n") };
}
