/**
 * The services a trader can connect (Paket Verbindungen). Everyone connects THEIR OWN accounts; nothing here is hosted
 * for them. One catalog for the placeholder (`ConnectSlot`), the dialog and the hub in Einstellungen → Verbindungen.
 */
import type { PartnerId } from "./partners";

export const SERVICE_IDS = ["tradingview", "binance-spot", "binance-futures", "bitunix", "alert-email", "alert-phone", "cloud"] as const;
export type ServiceId = (typeof SERVICE_IDS)[number];

export const isServiceId = (v: unknown): v is ServiceId => typeof v === "string" && (SERVICE_IDS as readonly string[]).includes(v);

export type ServiceGroup = "exchange" | "signal" | "alert" | "account";

export interface ServiceDef {
  id: ServiceId;
  /** Short name on the placeholder and the dialog title. */
  name: string;
  /** Two letters in the tile. */
  glyph: string;
  /** What the connection is for, in the trader's words (one sentence). */
  what: string;
  group: ServiceGroup;
  /** Partner programme behind "Noch kein Konto?" (links only when the operator set one). */
  partner?: PartnerId;
}

export const SERVICES: Readonly<Record<ServiceId, ServiceDef>> = {
  tradingview: {
    id: "tradingview",
    name: "TradingView",
    glyph: "TV",
    what: "Deine TradingView-Alarme schicken Signale an eine Zieladresse, die nur dir gehört.",
    group: "signal",
    partner: "tradingview",
  },
  "binance-spot": {
    id: "binance-spot",
    name: "Binance Spot",
    glyph: "BS",
    what: "Holt deine Spot-Käufe und -Verkäufe automatisch ins Journal – nur Lesen.",
    group: "exchange",
    partner: "binance",
  },
  "binance-futures": {
    id: "binance-futures",
    name: "Binance Futures",
    glyph: "BF",
    what: "Holt deine USDⓈ-M-Futures-Trades automatisch ins Journal – nur Lesen.",
    group: "exchange",
    partner: "binance",
  },
  bitunix: {
    id: "bitunix",
    name: "Bitunix",
    glyph: "BX",
    what: "Holt deine Bitunix-Futures-Trades automatisch ins Journal – nur Lesen.",
    group: "exchange",
    partner: "bitunix",
  },
  "alert-email": {
    id: "alert-email",
    name: "E-Mail-Alarm",
    glyph: "@",
    what: "Schickt dir eine E-Mail, wenn eine deiner Marken erreicht ist – auch bei geschlossener App.",
    group: "alert",
  },
  "alert-phone": {
    id: "alert-phone",
    name: "Telefon-Alarm",
    glyph: "☎",
    what: "Ruft dich an, wenn ein wichtiger Alarm auslöst.",
    group: "alert",
  },
  cloud: {
    id: "cloud",
    name: "Cloud-Konto",
    glyph: "CL",
    what: "Dein Journal auf allen Geräten. Ohne Konto bleibt alles auf diesem Gerät.",
    group: "account",
  },
};

export const GROUP_LABEL: Readonly<Record<ServiceGroup, string>> = {
  exchange: "Börsen",
  signal: "Signale",
  alert: "Alarme",
  account: "Konto",
};

/** Order in the hub. */
export const HUB_ORDER: readonly ServiceId[] = ["cloud", "binance-spot", "binance-futures", "bitunix", "tradingview", "alert-email", "alert-phone"];

/**
 * Telefon-Alarme gibt es noch nicht (kein Anbieter-Zugang, keine Funktion): der Platzhalter sagt das ehrlich als „nicht
 * eingerichtet“. Erst wenn der Alarm-Dienst existiert, wird das hier auf `true` gesetzt.
 */
export const PHONE_ALERTS_READY = false;

/** Binance market of a service id, or null. */
export function binanceMarketOf(id: ServiceId): "spot" | "futures" | null {
  return id === "binance-spot" ? "spot" : id === "binance-futures" ? "futures" : null;
}
