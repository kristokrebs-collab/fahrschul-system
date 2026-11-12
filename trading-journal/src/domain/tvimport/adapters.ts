/**
 * What the journal and the lab can and cannot do with TradingView (F14) – stated plainly, as data the UI renders and the
 * tests pin. There is no login to TradingView, no scraping and no execution of foreign (Pine) code anywhere in the app.
 *
 * Status:
 * - `supported`  – works end to end with data the trader exports or sends himself.
 * - `forward`    – only from now on and only for what an alert sends (a forward test, no history).
 * - `unsupported`– not possible here, with the reason and what to do instead.
 */
export type AdapterStatus = "supported" | "forward" | "unsupported";

export interface TvAdapter {
  id: "pine-export" | "tester-export" | "indicator-check" | "alert-webhook" | "pine-strategy" | "pine-indicator" | "indicator-series" | "account";
  title: string;
  status: AdapterStatus;
  /** one sentence: what it is */
  what: string;
  /** why it has this status / its limits */
  limits: string;
}

export const STATUS_LABEL: Readonly<Record<AdapterStatus, string>> = { supported: "unterstützt", forward: "nur Forwardtest über Alert", unsupported: "nicht unterstützt" };

export const TV_ADAPTERS: readonly TvAdapter[] = [
  {
    id: "pine-export",
    title: "Pine-Skript aus deiner Idee („Eigene Idee“)",
    status: "supported",
    what: "Das Labor schreibt den Regelbaum deiner Idee als lesbare Pine-v6-Strategie. Du fügst sie in TradingView ein und siehst dieselben Regeln auf dessen Kerzen.",
    limits: "Nur ein Text zum Einfügen und ein Link auf den Chart, kein Login. Bausteine ohne Pine-Entsprechung (MCB-Punkte, MCB-Leiter, Premium/Discount, RSI-Linie, Funding) werden namentlich aufgelistet und stehen im Skript als Eingabe, Standard aus. Die Ergebnisse weichen wegen Kerzen, Gebühren und Annahmen ab; die App kann das Skript nicht selbst ausführen oder prüfen.",
  },
  {
    id: "tester-export",
    title: "Strategietester-Export („List of trades“, CSV)",
    status: "supported",
    what: "Du exportierst die Tradeliste einer Pine-Strategie aus TradingView und lädst die CSV hier im Browser. Das Labor vergleicht sie mit einem eigenen Lauf.",
    limits: "Die Datei bleibt auf deinem Gerät. Sie nennt weder Markt noch Zeiteinheit; offene Trades zählen nicht. Der Vergleich zeigt Unterschiede, er beweist keine Ursache.",
  },
  {
    id: "indicator-check",
    title: "Indikator-Abgleich (Chartdaten-Export, CSV)",
    status: "supported",
    what: "Du exportierst die Chartdaten mit deinen Indikatoren aus TradingView und lädst die CSV hier im Browser. Das Labor rechnet den Indikator auf denselben Kerzen selbst und hält ihn Kerze für Kerze gegen die Spalte der Datei.",
    limits: "Eine Prüfung der Berechnung, keine Datenquelle: Die Spalten werden nicht als Baustein oder für einen Lauf verwendet. Ein Ergebnis gilt für diesen Markt, Zeitraum, diese Zeiteinheit und diese Eingaben. Ein kurzer Export kann am Anfang abweichen, weil TradingView mit mehr Historie startete (das sagt der Abgleich). Warmup, Rechenweg und Wiederzeichnen je Indikator stehen im Vertrag darüber.",
  },
  {
    id: "alert-webhook",
    title: "Alerts per Webhook (Konto → API & Webhooks)",
    status: "forward",
    what: "Ein TradingView-Alert schickt „open“ und „close“ an deine persönliche Webhook-Adresse; daraus entstehen echte Trades im Journal.",
    limits: "Nur ab dem Zeitpunkt des Alerts, nichts rückwirkend. Es sind Trades, keine reinen Signale: ohne Positionsgröße (qty) legt der Webhook keinen Trade an. Den Schutz bildet das geheime Token in der Adresse.",
  },
  {
    id: "pine-strategy",
    title: "Fremde Pine-Strategie ausführen oder in Regeln übersetzen",
    status: "unsupported",
    what: "Fremden Pine-Code laden, ausführen oder automatisch in den Regelbaum des Labors umwandeln (der umgekehrte Weg zum Pine-Export).",
    limits: "Die App führt keinen fremden Code aus und liest keinen Pine-Quelltext. Baue die Regeln im Labor („Eigene Idee“) nach und vergleiche sie mit dem Export deiner Strategie.",
  },
  {
    id: "pine-indicator",
    title: "Pine-Indikator als Baustein",
    status: "unsupported",
    what: "Einen eigenen Indikator aus TradingView als Bedingung im Regelbaum verwenden.",
    limits: "Dafür müsste der Indikator hier laufen. Das Labor kennt feste, getestete Bausteine (RSI, WaveTrend, gleitende Durchschnitte, MACD, Bollinger und weitere). Für „nur Forwardtest“ kannst du den Indikator einen Alert schicken lassen.",
  },
  {
    id: "indicator-series",
    title: "Indikatorreihen und Chartdaten aus TradingView",
    status: "unsupported",
    what: "Exportierte Indikatorwerte oder Chart-CSV im Labor als Datenreihe oder Baustein für einen Lauf nutzen.",
    limits: "Das Labor rechnet nur auf echten Binance-Kerzen mit eigenen Bausteinen. Fremde Datenreihen hätten andere Quellen und Zeitstempel und würden die Ergebnisse unvergleichbar machen. Zum Prüfen unserer Berechnung lässt sich der Export dagegen einlesen (Indikator-Abgleich).",
  },
  {
    id: "account",
    title: "Zugriff auf dein TradingView-Konto",
    status: "unsupported",
    what: "Anmelden, Skripte oder gespeicherte Layouts und Strategien automatisch abrufen.",
    limits: "Bewusst ausgeschlossen: kein Login, kein Auslesen der Seite. Alles, was hier ankommt, hast du selbst exportiert oder per Alert gesendet.",
  },
];

/** Adapters of one status. */
export const adaptersOf = (status: AdapterStatus): readonly TvAdapter[] => TV_ADAPTERS.filter((a) => a.status === status);
