/** Markt page (P02): Box zu Box live. See `README.md`. */
export { MarktView, MARKT_LEAD_FILL, bandItems } from "./MarktView";
export { BestSetupsCard, SetupExplain } from "./BestSetupsCard";
export { BoxChartCard } from "./BoxChartCard";
export { BoxStateCard, railIndex, pillOf, gaugeY } from "./BoxStateCard";
export { RsiLinesCard, miniGeo } from "./RsiLinesCard";
export { ScannerCard } from "./ScannerCard";
export { BoxSettingsCard, writeBoxes } from "./BoxSettingsCard";
export { toChartBoxes, chartBoxesKey, type ToChartBoxesOptions } from "./chartBoxes";
export { MARKT, TF_TEXT, RAIL } from "./strings";
// the alert host the app mounts once (P14 wiring), re-exported for one import site
export { BoxAlertHost } from "@/market/boxes/alerts";
