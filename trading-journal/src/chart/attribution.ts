/**
 * Apache-2.0 attribution (Plan 5.8). `attributionLogo:false` requires the NOTICE text and a link to
 * tradingview.com on the page (footer). `public/NOTICE-lightweight-charts.txt` holds the notice file.
 * Plain data in its own module (P14): the footer imports it without `lightweight-charts` (`theme.ts` re-exports it).
 */
export const CHART_ATTRIBUTION = {
  notice: "TradingView Lightweight Charts™ · Copyright (с) 2025 TradingView, Inc. · ",
  linkText: "tradingview.com",
  href: "https://www.tradingview.com/",
  /** alternative link text if the footer prefers a sentence */
  linkTextLong: "Charting by TradingView",
  dataLine: "Marktdaten: Binance Futures (öffentlich)",
} as const;
