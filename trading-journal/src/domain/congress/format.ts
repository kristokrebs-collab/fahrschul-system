/**
 * The words and figures of a Congress row, in German – what the filing says, not more. Pure.
 *
 * Amounts stay RANGES exactly as printed ("$1,000,001 – $5,000,000"); they are never turned into a single figure. The owner
 * column of the form is "SP" spouse, "JT" joint, "DC" dependent child, blank = the member.
 */
import type { CongressOption, CongressOwner, CongressSide, CongressTrade } from "@/market/congress/wire";

export const OWNER_LABEL: Readonly<Record<CongressOwner, string>> = { self: "Mitglied selbst", spouse: "Ehepartner", joint: "gemeinsam", child: "abhängiges Kind" };
export const SIDE_LABEL: Readonly<Record<CongressSide, string>> = { buy: "Kauf", sell: "Verkauf", "sell-partial": "Teilverkauf", exchange: "Tausch" };

/** The House's asset type codes the app names; every other code is shown as printed ("[AB]"). */
export const ASSET_CODE_LABEL: Readonly<Record<string, string>> = {
  ST: "Aktie",
  OP: "Option",
  EF: "ETF",
  MF: "Investmentfonds",
  CT: "Kryptowährung",
  CS: "Unternehmensanleihe",
  GS: "Staatsanleihe",
};

/** `2026-08-21` → `21.08.2026`; anything else → "–". */
export function dayDe(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso ?? "");
  return m ? `${m[3]}.${m[2]}.${m[1]}` : "–";
}

/** The range as printed, with an en dash: "$1,001 – $15,000". An amount that is no range ("$2,722.50") stays as printed. */
export function amountDe(t: Pick<CongressTrade, "amountText">): string {
  return t.amountText.replace(/\s*-\s*/g, " – ");
}

/** True when the filing printed a range (two bounds, or "Over $X"); false for a single printed figure. */
export const isRange = (t: Pick<CongressTrade, "amountLow" | "amountHigh" | "amountText">): boolean => t.amountLow !== null && (t.amountHigh === null ? /^over\b/i.test(t.amountText) : t.amountHigh !== t.amountLow);

const usd = (n: number): string => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** "Call · 100 Kontrakte · Strike $100 · Verfall 17.06.2027" – only what the description states; the rest says "nicht erkannt" (the description itself is shown next to it). */
export function optionLine(o: CongressOption): string {
  const bits: string[] = [];
  if (o.exercised) bits.push("ausgeübt");
  bits.push(o.kind === "call" ? "Call" : o.kind === "put" ? "Put" : "Option");
  if (o.contracts !== null) bits.push(`${o.contracts.toLocaleString("de-DE")} ${o.contracts === 1 ? "Kontrakt" : "Kontrakte"}`);
  bits.push(o.strike !== null ? `Strike ${usd(o.strike)}` : "Strike nicht erkannt");
  bits.push(o.expires ? `Verfall ${dayDe(o.expires)}` : "Verfall nicht erkannt");
  return bits.join(" · ");
}
