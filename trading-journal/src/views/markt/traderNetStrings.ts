/** German copy of the "Top-Trader: Netto Long/Short" card on the Markt page. Plain words; the series is never called "Wale" and never "Glassnode". */
export const NETCARD = {
  title: "Top-Trader: Netto Long/Short",
  note: "Long minus Short der größten Konten auf Binance, in Prozentpunkten",
  rangeLabel: "Zeitraum",
  seriesLabel: "Reihe",
  seriesHint: "Positionen: Long-Anteil der Positionsgrößen · Konten: Anteil der Konten mit Long-Position",
  legendLong: "netto Long",
  legendShort: "netto Short",
  legendPrice: "Preislinie (Skala rechts)",
  legendFlip: "Umschlag",
  legendWarn: "Vorwarnung",
  legendConfirm: "Bestätigung",
  legendGap: "Lücke (keine Daten)",
  /** what the series is and is not, in one place (the card shows it under the plot) */
  help: "Das sind die größten Konten (obere 20 % nach Einsatz) auf Binance Futures, eine einzelne Börse – keine On-Chain-Wale. Die Reihe zeigt, wie diese Konten positioniert sind, und sagt nichts über den Kurs voraus. Binance hält höchstens etwa 30 Tage Verlauf bereit; was länger zurückliegt, zeigt die Karte nur aus dem Verlauf, den dieses Gerät selbst gespeichert hat.",
  loading: "Top-Trader-Daten werden geladen …",
  /** the rule behind the marks, then what they are not */
  marksHelp: "Die Marken zeigen, wann der Alarm „Top-Trader-Umschlag“ mit seinen Standard-Schwellen angeschlagen hätte (deine Alarm-Einstellungen ändern sie nicht). Nach einer Lücke beginnt die Prüfung neu. Ein Rückblick auf eine Regel – keine Empfehlung und keine Prognose.",
  archiveSwitch: "Verlauf auf diesem Gerät merken",
  archiveCsv: "Als CSV",
  archiveDelete: "Löschen",
  archiveSure: "Gespeicherten Verlauf wirklich löschen?",
  archiveSureYes: "Ja, löschen",
  archiveSureNo: "Abbrechen",
  archiveExported: "Verlauf als CSV gespeichert.",
  archiveStateNote: "Binance liefert gerade nichts – gezeigt wird der Verlauf, den dieses Gerät gespeichert hat.",
} as const;
