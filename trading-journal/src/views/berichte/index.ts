/**
 * Berichte views (P04). The integrator (P14) registers `BerichteView` as page `berichte`, mounts `<ReportReadyHost
 * onOpen={() => navigate("berichte")} />` once in App.tsx and wires `#berichte?p=<key>` through the store seam below.
 * See README.md.
 */
export { BerichteView, BERICHTE_LEAD_FILL, SEEN_AFTER_MS } from "./BerichteView";
export { ReportReadyHost, READY_KEY, readAnnounced } from "./ReportReady";
export { ReportDocument, ReportPrint, PRINT_CLASS } from "./ReportPrint";
export { useBerichteUi, openReport, berichteQuery, berichtePeriodFromQuery, BERICHTE_QUERY_KEY, type FlapDir } from "./berichteStore";
export { useReportPage, resolvePeriod, periodBars } from "./hooks";
