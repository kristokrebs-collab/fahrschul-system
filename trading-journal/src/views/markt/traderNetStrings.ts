/** German copy of the "Top-Trader: Netto Long/Short" card on the Markt page. Plain words; the series is never called "Wale" and never "Glassnode". */
export const NETCARD = {
  title: "Top-Trader: Netto Long/Short",
  note: "Long minus Short der größten Konten auf Binance, in Prozentpunkten",
  rangeLabel: "Zeitraum",
  legendLong: "netto Long",
  legendShort: "netto Short",
  legendPrice: "Preislinie (Skala rechts)",
  legendFlip: "Umschlag",
  /** what the series is and is not, in one place (the card shows it under the plot) */
  help: "Das sind die größten Konten (obere 20 % nach Einsatz) auf Binance Futures, eine einzelne Börse – keine On-Chain-Wale. Die Reihe zeigt, wie diese Konten positioniert sind, und sagt nichts über den Kurs voraus. Binance hält höchstens etwa 30 Tage Verlauf bereit, mehr kann die Karte nicht zeigen.",
  loading: "Top-Trader-Daten werden geladen …",
} as const;
