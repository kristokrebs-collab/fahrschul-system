/**
 * The one place that imports further news sources (a side-effect import registers them with `registerNewsSource`).
 * The news section of `#aktien` imports this file, so a source listed here shows up in the monitor with its own status
 * line. Yahoo Finance headlines are built in (`news.ts`).
 *
 * Planned: SEC EDGAR 8-K filings (own function, needs `SEC_USER_AGENT` – built by another part of the project). Its module
 * calls `registerNewsSource({ id: "sec-edgar", label: "SEC EDGAR (8-K)", load })` and is imported here:
 *
 *     import "./sec8k";
 */
export {};
