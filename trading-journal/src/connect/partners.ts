/**
 * Partner links (Paket Verbindungen) – OFF by default. The operator sets the full link of a partner programme in the
 * build environment; without it nothing is shown. The link is used exactly as given: no ids, parameters, e-mail
 * addresses or anything about the user is ever added, nothing is tracked, no redirect through our server.
 *
 *   VITE_PARTNER_TRADINGVIEW_REF   full https link of the TradingView programme
 *   VITE_PARTNER_BINANCE_REF       full https link of the Binance referral programme
 *   VITE_PARTNER_BITUNIX_REF       full https link of the Bitunix referral programme
 *
 * Whether and which programmes exist is the operator's research and contract – no id, rate or programme is invented
 * here. See `docs/PARTNERLINKS.md`.
 */

export const PARTNER_IDS = ["tradingview", "binance", "bitunix"] as const;
export type PartnerId = (typeof PARTNER_IDS)[number];

export const PARTNER_NAME: Readonly<Record<PartnerId, string>> = { tradingview: "TradingView", binance: "Binance", bitunix: "Bitunix" };

export const PARTNER_ENV: Readonly<Record<PartnerId, string>> = {
  tradingview: "VITE_PARTNER_TRADINGVIEW_REF",
  binance: "VITE_PARTNER_BINANCE_REF",
  bitunix: "VITE_PARTNER_BITUNIX_REF",
};

/** The visible mark next to every partner link (UWG / DDG: advertising must be recognisable as such). */
export const PARTNER_NOTICE = "Partnerlink – wir erhalten ggf. eine Provision, für dich ändert sich nichts.";

export interface PartnerLink {
  id: PartnerId;
  name: string;
  /** The operator's link, unchanged. */
  href: string;
  /** `rel` of the anchor: sponsored (advertising), no opener, no referrer. */
  rel: "sponsored noopener noreferrer";
  notice: string;
}

type EnvLike = Record<string, string | undefined>;

/** Only a plain https link without credentials, whitespace or fragments of script is accepted; anything else = no link. */
export function cleanPartnerUrl(raw: string | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v || v.length > 500 || /\s/.test(v)) return null;
  try {
    const u = new URL(v);
    if (u.protocol !== "https:" || u.username || u.password || !u.hostname.includes(".")) return null;
    return u.toString();
  } catch {
    return null;
  }
}

/** The partner link of `id`, or null while the operator has not set a (valid) one. `env` is injectable for tests. */
export function partnerLink(id: PartnerId, env: EnvLike = import.meta.env as unknown as EnvLike): PartnerLink | null {
  const href = cleanPartnerUrl(env[PARTNER_ENV[id]]);
  return href ? { id, name: PARTNER_NAME[id], href, rel: "sponsored noopener noreferrer", notice: PARTNER_NOTICE } : null;
}
